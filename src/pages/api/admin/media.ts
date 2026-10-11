import { readForm, uploadFormBytes } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ADMIN, canAccess } from '../../../lib/admin';
import { cleanText, sameOrigin } from '../../../lib/forum';
import { MAX_UPLOAD_BYTES, MEDIA_PAGE_SIZE, batchWithUploads, checkUpload, detailsFrom, getMedia, listMedia, mediaAudit, mediaUsage, parseMediaPage, storeMedia, toItem, validateDetails } from '../../../lib/media';

// The editor's picker lists and uploads through here with fetch, so those answers are JSON.
// Deleting is a plain form post from the item's page. Editing details happens on that page.
const json = (body: unknown, status = 200) => Response.json(body, { status });

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user || !canAccess(locals.staffRole, ADMIN.media)) return json({ error: 'Forbidden' }, 403);
  const page = parseMediaPage(url.searchParams.get('page'));
  if (page === null) return json({ error: 'Invalid page' }, 400);
  const rows = await listMedia((url.searchParams.get('q') ?? '').trim().slice(0, 100), page);
  return json({ items: rows.slice(0, MEDIA_PAGE_SIZE).map(toItem), more: rows.length > MEDIA_PAGE_SIZE });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || !canAccess(locals.staffRole, ADMIN.media)) return new Response('Forbidden', { status: 403 });
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request, uploadFormBytes(MAX_UPLOAD_BYTES));

  if (form instanceof Response) return form;
  const action = cleanText(form.get('action'));

  if (action === 'upload') {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return json({ error: 'Choose an image to upload.' }, 400);
    const details = detailsFrom(form);
    const errors = validateDetails(details);
    const checked = await checkUpload(file);
    if (typeof checked === 'string') errors.unshift(checked);
    if (errors.length || typeof checked === 'string') return json({ error: errors.join(' ') }, 400);
    const { record, statement } = await storeMedia(checked, file.name, details, actor.id);
    await batchWithUploads([record], [statement, mediaAudit(actor, record, 'media-upload', `${record.width}×${record.height}`)]);
    return json({ item: toItem(record) }, 201);
  }

  if (action === 'delete') {
    const media = await getMedia(cleanText(form.get('mediaId')));
    if (!media) return new Response('Image not found', { status: 404 });
    const back = (params: Record<string, string>, path = `/admin/media/${media.id}`) => {
      const url = new URL(path, request.url);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return Response.redirect(url, 303);
    };
    const usage = await mediaUsage(media);
    if (usage.stories.length || usage.ads.length || usage.events.length) return back({ error: 'in-use' });
    await env.DB.batch([
      mediaAudit(actor, media, 'media-delete', media.credit),
      env.DB.prepare('DELETE FROM media WHERE id = ?').bind(media.id),
    ]);
    await env.MEDIA.delete(media.object_key);
    return back({ deleted: media.filename }, '/admin/media');
  }

  return new Response('Invalid action', { status: 400 });
};
