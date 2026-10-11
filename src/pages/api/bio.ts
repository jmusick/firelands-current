import type { APIRoute } from 'astro';
import { ADMIN, canAccess } from '../../lib/admin';
import { denyAdmin } from '../../lib/audit';
import { saveStaffBio } from '../../lib/bios';
import { cleanText, sameOrigin } from '../../lib/forum';
import { FORM_BYTES, readForm } from '../../lib/request-body';

// Staff edit their own author bio from /account; administrators edit any staff member's from /admin/users/<id>.
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || !locals.staffRole) return new Response('Forbidden', { status: 403 });
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });
  const form = await readForm(request, FORM_BYTES);
  if (form instanceof Response) return form;

  const requested = cleanText(form.get('userId'));
  if (requested && !/^[\w-]{1,64}$/.test(requested)) return new Response('Invalid user', { status: 400 });
  const targetId = requested || actor.id;
  const own = targetId === actor.id;
  if (!own && !canAccess(locals.staffRole, ADMIN.users)) return denyAdmin(locals, request, 'user-admin', 'role');

  const back = (params: Record<string, string>) => {
    const url = new URL(own ? '/account' : `/admin/users/${targetId}`, request.url);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return Response.redirect(url, 303);
  };
  const result = await saveStaffBio(actor, targetId, typeof form.get('bio') === 'string' ? String(form.get('bio')) : '');
  if (result === 'not-found') return new Response('User not found', { status: 404 });
  if (result === 'not-staff') return new Response('Only staff have an author bio', { status: 400 });
  if (result === 'too-long') return back({ bioError: 'too-long' });
  return back({ bio: result });
};
