import { readForm } from '../../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { auditRecord, denyAdmin } from '../../../../lib/audit';
import { cleanText, sameOrigin } from '../../../../lib/forum';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in?next=/admin/news', request.url), 303);
  if (locals.staffRole !== 'admin') return denyAdmin(locals, request, 'story-delete', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'story-delete', 'origin');

  const form = await readForm(request);
  if (form instanceof Response) return form;
  const id = cleanText(form.get('id'));
  // The entry reads the headline before the story goes, and exists only if the story does.
  if (id) await env.DB.batch([
    auditRecord(locals.user, 'story', id, 'story-delete'),
    env.DB.prepare('DELETE FROM news_articles WHERE id = ?').bind(id),
  ]);
  return Response.redirect(new URL('/admin/news?deleted=1', request.url), 303);
};
