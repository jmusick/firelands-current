import { readForm } from '../../../../lib/request-body';
import type { APIRoute } from 'astro';
import { ADMIN, canAccess } from '../../../../lib/admin';
import { resolveFacebookPost } from '../../../../lib/facebook-admin';
import { denyAdmin } from '../../../../lib/audit';
import { cleanText, sameOrigin } from '../../../../lib/forum';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.user || !canAccess(locals.staffRole, ADMIN.facebook)) return denyAdmin(locals, request, 'facebook-resolve', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'facebook-resolve', 'origin');
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const id = cleanText(form.get('id'));
  const action = cleanText(form.get('action'));
  const postId = cleanText(form.get('post_id'));
  if (!/^[\w-]{1,64}$/.test(id) || !['queue', 'record'].includes(action) || form.get('checked_page') !== '1') {
    return new Response('Check the Page and confirm the selected action.', { status: 400 });
  }
  if (action === 'record' && !/^\d{1,32}_\d{1,32}$/.test(postId)) return new Response('Enter the full Page post ID, in pageid_postid format.', { status: 400 });
  try {
    const changed = await resolveFacebookPost(locals.user, id, action as 'queue' | 'record', postId);
    if (!changed) return new Response('The story status changed, or the post belongs to another Page. Refresh and check again.', { status: 409 });
  } catch {
    return new Response('The change could not be saved. Check that this post ID is not already assigned to another story.', { status: 409 });
  }
  return redirect('/admin/facebook?updated=1', 303);
};
