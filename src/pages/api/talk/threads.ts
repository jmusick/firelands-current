import { readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cleanText, redirectWithError, sameOrigin } from '../../../lib/forum';
import { QUOTAS } from '../../../lib/quotas';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in?next=/talk/new', request.url), 303);
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const title = cleanText(form.get('title'));
  const body = cleanText(form.get('body'));
  if (title.length < 8 || title.length > 140 || body.length < 20 || body.length > 10000) {
    return redirectWithError(request, '/talk/new', 'length');
  }

  // The limit is checked inside the INSERT, so concurrent requests can't each count the same rows and all pass.
  const now = Date.now();
  const id = crypto.randomUUID();
  const { max, windowMs } = QUOTAS.thread;
  const stored = await env.DB.prepare(`
    INSERT INTO forum_threads (id, author_id, title, body, created_at, updated_at, last_activity_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?5, ?5
    WHERE (SELECT COUNT(*) FROM forum_threads WHERE author_id = ?2 AND created_at > ?6) < ?7
  `).bind(id, locals.user.id, title, body, now, now - windowMs, max).run();
  if (!stored.meta.changes) return redirectWithError(request, '/talk/new', 'rate');
  return Response.redirect(new URL(`/talk/${id}`, request.url), 303);
};
