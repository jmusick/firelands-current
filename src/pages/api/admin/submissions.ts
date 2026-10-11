import { FORM_BYTES, readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ADMIN, canAccess } from '../../../lib/admin';
import { auditRecord, denyAdmin } from '../../../lib/audit';
import { cleanText, sameOrigin } from '../../../lib/forum';

// Statuses a tip may move out of for each action. Anything else is a quiet no-op so a repeated
// or stale click never rewrites state or adds a duplicate audit entry.
const FROM: Record<string, string[]> = { reviewed: ['unread'], declined: ['unread', 'reviewed'] };

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return Response.redirect(new URL('/sign-in?next=/admin/submissions', request.url), 303);
  if (!canAccess(locals.staffRole, ADMIN.submissions)) return denyAdmin(locals, request, 'tip-review', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'tip-review', 'origin');
  const form = await readForm(request, FORM_BYTES);
  if (form instanceof Response) return form;
  const id = cleanText(form.get('id'));
  const status = cleanText(form.get('status'));
  if (!/^[\w-]{8,64}$/.test(id) || !Object.hasOwn(FROM, status)) return new Response('Invalid submission action', { status: 400 });
  const tip = await env.DB.prepare('SELECT status FROM news_submissions WHERE id = ?').bind(id).first<{ status: string }>();
  if (!tip || tip.status === 'converted') return new Response('News tip not found or already converted', { status: 404 });
  const from = FROM[status];
  const marks = from.map(() => '?').join(', ');
  const now = Date.now();
  // The audit row and the update share one batch, and the audit row is only written while the tip
  // is still in a status the action applies to. Tip text, names and emails are never logged.
  await env.DB.batch([
    auditRecord(locals.user, 'tip', id, `tip-${status}`, `${tip.status} → ${status}`, { sql: `status IN (${marks})`, binds: from }),
    env.DB.prepare(`UPDATE news_submissions SET status = ?, updated_at = ? WHERE id = ? AND status IN (${marks})`).bind(status, now, id, ...from),
  ]);
  return Response.redirect(new URL(`/admin/submissions/${id}`, request.url), 303);
};
