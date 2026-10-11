import { readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { MAX_REPLY_DEPTH, cleanText, getThread, redirectWithError, returnPathFor, sameOrigin } from '../../../lib/forum';
import { QUOTAS } from '../../../lib/quotas';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in', request.url), 303);
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const threadId = cleanText(form.get('threadId'));
  const body = cleanText(form.get('body'));
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return new Response('Invalid thread', { status: 400 });

  const thread = await getThread(threadId);
  if (!thread) return new Response('Thread not found', { status: 404 });
  const returnPath = returnPathFor(cleanText(form.get('returnTo')), thread);
  if (body.length < 2 || body.length > 5000) return redirectWithError(request, returnPath, 'length', 'comments');

  // A reply to a comment: the comment must be visible and in this discussion, and not already at the deepest level.
  const parentId = cleanText(form.get('parentId'));
  if (parentId) {
    if (!/^[0-9a-f-]{36}$/i.test(parentId)) return new Response('Invalid comment', { status: 400 });
    const parent = await env.DB.prepare(`
      WITH RECURSIVE chain(id, parent_id, thread_id, status, depth) AS (
        SELECT id, parent_id, thread_id, status, 0 FROM forum_replies WHERE id = ?
        UNION ALL SELECT r.id, r.parent_id, r.thread_id, r.status, chain.depth + 1 FROM forum_replies r JOIN chain ON r.id = chain.parent_id
      )
      SELECT (SELECT thread_id FROM chain WHERE depth = 0) AS thread_id, (SELECT status FROM chain WHERE depth = 0) AS status, MAX(depth) AS depth FROM chain
    `).bind(parentId).first<{ thread_id: string | null; status: string | null; depth: number }>();
    if (parent?.thread_id !== threadId || parent.status !== 'published') return new Response('Comment not found', { status: 404 });
    if (parent.depth >= MAX_REPLY_DEPTH) return new Response('Replies are nested too deeply', { status: 400 });
  }

  // The limit is checked inside the INSERT, so concurrent requests can't each count the same rows and all pass.
  // The batch is one transaction; the thread only counts as active if the reply was stored.
  const now = Date.now();
  const id = crypto.randomUUID();
  const { max, windowMs } = QUOTAS.reply;
  const [stored] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO forum_replies (id, thread_id, parent_id, author_id, body, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6
      WHERE (SELECT COUNT(*) FROM forum_replies WHERE author_id = ?4 AND created_at > ?7) < ?8`)
      .bind(id, threadId, parentId || null, locals.user.id, body, now, now - windowMs, max),
    env.DB.prepare('UPDATE forum_threads SET last_activity_at = ?1, updated_at = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM forum_replies WHERE id = ?3)')
      .bind(now, threadId, id),
  ]);
  if (!stored.meta.changes) return redirectWithError(request, returnPath, 'rate', 'comments');
  const url = new URL(returnPath, request.url);
  url.hash = `reply-${id}`;
  return Response.redirect(url, 303);
};
