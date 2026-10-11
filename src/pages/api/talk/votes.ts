import { readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cleanText, getThread, returnPathFor, sameOrigin } from '../../../lib/forum';
import { quotaResponse, takeQuota } from '../../../lib/quotas';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in', request.url), 303);
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const kind = cleanText(form.get('kind'));
  const id = cleanText(form.get('id'));
  const vote = cleanText(form.get('vote'));
  if ((kind !== 'thread' && kind !== 'reply') || !/^[0-9a-f-]{36}$/i.test(id) || (vote !== 'up' && vote !== 'down')) {
    return new Response('Invalid vote', { status: 400 });
  }

  const retryAfter = await takeQuota('vote', request, locals.user.id);
  if (retryAfter !== null) return quotaResponse(retryAfter);

  const threadId = kind === 'thread'
    ? id
    : (await env.DB.prepare("SELECT thread_id FROM forum_replies WHERE id = ? AND status = 'published'").bind(id).first<{ thread_id: string }>())?.thread_id;
  const thread = threadId ? await getThread(threadId) : null;
  if (!thread) return new Response('Not found', { status: 404 });

  const table = kind === 'thread' ? 'forum_thread_votes' : 'forum_reply_votes';
  const column = kind === 'thread' ? 'thread_id' : 'reply_id';
  const value = vote === 'up' ? 1 : -1;
  const existing = await env.DB.prepare(`SELECT value FROM ${table} WHERE ${column} = ? AND user_id = ?`)
    .bind(id, locals.user.id).first<{ value: number }>();
  // Choosing the vote you already cast takes it back, as on Reddit.
  if (existing?.value === value) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND user_id = ?`).bind(id, locals.user.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO ${table} (${column}, user_id, value, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(${column}, user_id) DO UPDATE SET value = excluded.value
    `).bind(id, locals.user.id, value, Date.now()).run();
  }

  const url = new URL(returnPathFor(cleanText(form.get('returnTo')), thread), request.url);
  url.hash = kind === 'reply' ? `reply-${id}` : 'discussion';
  return Response.redirect(url, 303);
};
