import type { APIRoute } from 'astro';
import { cleanText, sameOrigin } from '../../lib/forum';
import { quotaResponse, takeQuota } from '../../lib/quotas';
import { MAX_PASSWORD } from '../../lib/password-policy';
import { reauthPath, recordReauth, safeNext } from '../../lib/reauth';
import { readForm } from '../../lib/request-body';
import { verifyAccountPassword } from '../../lib/users';

/** Confirms the signed-in person's password, which opens the window for privileged actions, then returns them to `next`. */
export const POST: APIRoute = async ({ request, locals }) => {
  const { user, session } = locals;
  if (!user || !session) return new Response('Forbidden', { status: 403 });
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);
  if (form instanceof Response) return form;
  const next = safeNext(cleanText(form.get('next')));
  const reason = cleanText(form.get('reason'));
  const go = (location: string) => Response.redirect(new URL(location, request.url), 303);

  const retryAfter = await takeQuota('reauth', request, user.id);
  if (retryAfter !== null) return quotaResponse(retryAfter);

  // Not trimmed: spaces can be part of a password.
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  if (!password || password.length > MAX_PASSWORD || !(await verifyAccountPassword(user.id, password))) {
    return go(`${reauthPath(next, reason)}&error=password`);
  }
  await recordReauth(session.id);
  return go(next);
};
