import { FORM_BYTES, readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ADMIN, canAccess } from '../../../lib/admin';
import { auditRecord, denyAdmin } from '../../../lib/audit';
import { cleanText, sameOrigin } from '../../../lib/forum';

// Statuses a submission may move out of for each action. Anything else is a quiet no-op so a repeated
// or stale click never rewrites state or adds a duplicate audit entry. Converting is not here: it happens
// when the draft event is saved (src/pages/admin/events/new.astro).
const FROM: Record<string, string[]> = { reviewed: ['unread'], declined: ['unread', 'reviewed'] };

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in?next=/admin/events/submissions', request.url), 303);
  if (!canAccess(locals.staffRole, ADMIN.events)) return denyAdmin(locals, request, 'event-submission-review', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'event-submission-review', 'origin');
  const form = await readForm(request, FORM_BYTES);
  if (form instanceof Response) return form;
  const id = cleanText(form.get('id'));
  if (!/^[\w-]{8,64}$/.test(id)) return new Response('Invalid submission action', { status: 400 });
  const detail = () => Response.redirect(new URL(`/admin/events/submissions/${id}`, request.url), 303);

  // Removes the submitter's name, email and note now rather than on the retention schedule, for a deletion
  // request. Any status; the event details stay.
  if (cleanText(form.get('action')) === 'anonymize') {
    if (!await env.DB.prepare('SELECT 1 FROM event_submissions WHERE id = ?').bind(id).first()) return new Response('Event submission not found', { status: 404 });
    const now = Date.now();
    await env.DB.batch([
      auditRecord(locals.user, 'event-submission', id, 'event-submission-anonymized', undefined, { sql: 'anonymized_at IS NULL', binds: [] }),
      env.DB.prepare(`UPDATE event_submissions SET name = '', email = '', note = '', anonymized_at = ?1, updated_at = ?1
        WHERE id = ?2 AND anonymized_at IS NULL`).bind(now, id),
    ]);
    return detail();
  }

  const status = cleanText(form.get('status'));
  if (!Object.hasOwn(FROM, status)) return new Response('Invalid submission action', { status: 400 });
  const item = await env.DB.prepare('SELECT status FROM event_submissions WHERE id = ?').bind(id).first<{ status: string }>();
  if (!item || item.status === 'converted') return new Response('Event submission not found or already converted', { status: 404 });
  const from = FROM[status];
  const marks = from.map(() => '?').join(', ');
  const now = Date.now();
  // The audit row and the update share one batch, and the audit row is only written while the submission
  // is still in a status the action applies to. Titles, names, emails and notes are never logged.
  // decided_at starts the retention clock for the new status (src/lib/event-submission-retention.ts).
  await env.DB.batch([
    auditRecord(locals.user, 'event-submission', id, `event-submission-${status}`, `${item.status} → ${status}`, { sql: `status IN (${marks})`, binds: from }),
    env.DB.prepare(`UPDATE event_submissions SET status = ?, updated_at = ?, decided_at = ? WHERE id = ? AND status IN (${marks})`).bind(status, now, now, id, ...from),
  ]);
  return detail();
};
