import { readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ADMIN, canAccess } from '../../../lib/admin';
import { auditRecord, denyAdmin } from '../../../lib/audit';
import { cleanText, sameOrigin } from '../../../lib/forum';

const UUID = /^[0-9a-f-]{36}$/i;
// Seeded demo rows use readable ids like "demo-t1".
const ID = /^(?:[0-9a-f-]{36}|demo-[a-z0-9]+)$/i;

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || !canAccess(locals.staffRole, ADMIN.talk)) return denyAdmin(locals, request, 'talk-moderate', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'talk-moderate', 'origin');

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const action = cleanText(form.get('action'));
  const now = Date.now();
  const back = Response.redirect(new URL('/admin/talk', request.url), 303);

  // Each moderation change shares a batch with its audit entry. Entries name the discussion or reply by
  // title and id only, never post text, and never who wrote or reported it.
  if (action === 'hide-thread' || action === 'restore-thread') {
    const threadId = cleanText(form.get('threadId'));
    if (!ID.test(threadId)) return new Response('Invalid discussion', { status: 400 });
    await env.DB.batch([
      auditRecord(actor, 'thread', threadId, action === 'hide-thread' ? 'thread-hide' : 'thread-restore'),
      env.DB.prepare('UPDATE forum_threads SET status = ?, updated_at = ? WHERE id = ?')
        .bind(action === 'hide-thread' ? 'hidden' : 'published', now, threadId),
    ]);
    return back;
  }

  const reportId = cleanText(form.get('reportId'));
  if (!UUID.test(reportId) || (action !== 'hide-reported' && action !== 'dismiss')) {
    return new Response('Invalid moderation action', { status: 400 });
  }
  const report = await env.DB.prepare("SELECT thread_id, reply_id FROM forum_reports WHERE id = ? AND status = 'open'")
    .bind(reportId).first<{ thread_id: string | null; reply_id: string | null }>();
  if (!report) return new Response('Report not found', { status: 404 });

  const detail = `Report ${reportId}`;
  if (action === 'dismiss') {
    // A dismissed report is recorded against the post it was about.
    await env.DB.batch([
      report.thread_id ? auditRecord(actor, 'thread', report.thread_id, 'report-dismiss', detail) : auditRecord(actor, 'reply', report.reply_id!, 'report-dismiss', detail),
      env.DB.prepare("UPDATE forum_reports SET status = 'dismissed', resolved_at = ? WHERE id = ?").bind(now, reportId),
    ]);
  } else if (report.thread_id) {
    await env.DB.batch([
      auditRecord(actor, 'thread', report.thread_id, 'thread-hide', `${detail}, hidden from a report`),
      env.DB.prepare("UPDATE forum_threads SET status = 'hidden', updated_at = ? WHERE id = ?").bind(now, report.thread_id),
      env.DB.prepare("UPDATE forum_reports SET status = 'resolved', resolved_at = ? WHERE thread_id = ? AND status = 'open'").bind(now, report.thread_id),
    ]);
  } else if (report.reply_id) {
    await env.DB.batch([
      auditRecord(actor, 'reply', report.reply_id, 'reply-hide', `${detail}, hidden from a report`),
      env.DB.prepare("UPDATE forum_replies SET status = 'hidden', updated_at = ? WHERE id = ?").bind(now, report.reply_id),
      env.DB.prepare("UPDATE forum_reports SET status = 'resolved', resolved_at = ? WHERE reply_id = ? AND status = 'open'").bind(now, report.reply_id),
    ]);
  }
  return back;
};
