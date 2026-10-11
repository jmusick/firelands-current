import type { APIRoute } from 'astro';
import { ADMIN, canAccess } from '../../../lib/admin';
import { denyAdmin } from '../../../lib/audit';
import { cleanText, sameOrigin } from '../../../lib/forum';
import { deleteLink, isLinkId } from '../../../lib/links';
import { readForm } from '../../../lib/request-body';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in?next=/admin/links', request.url), 303);
  if (!canAccess(locals.staffRole, ADMIN.links)) return denyAdmin(locals, request, 'link-delete', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'link-delete', 'origin');
  const form = await readForm(request);
  if (form instanceof Response) return form;
  if (cleanText(form.get('action')) !== 'delete') return new Response('Invalid action', { status: 400 });
  const id = cleanText(form.get('id'));
  if (!isLinkId(id)) return new Response('Invalid link', { status: 400 });
  if (cleanText(form.get('confirm')) !== 'DELETE') return new Response('Type DELETE to confirm', { status: 400 });
  if (!await deleteLink(id, locals.user)) return new Response('Link not found', { status: 404 });
  return Response.redirect(new URL('/admin/links?deleted=1', request.url), 303);
};
