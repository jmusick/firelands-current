import { env } from 'cloudflare:workers';

/**
 * Audit records for newsroom and moderation work: stories, events, discussions, corrections and news tips.
 * They go in `admin_audit_log` beside the user, business, ad and media entries (see `auditStatement` in
 * users.ts, `adAudit` and `mediaAudit`), with `target_type` and `target_id` naming the record.
 *
 * What goes in an entry: who (id and name), what (an action key, labelled in AUDIT_LABELS), which record
 * (type, id, and its title or slug), and field names or status changes. Never body text, tip text, or
 * submitter names and emails; callers pass only identifiers and the names of fields that changed.
 */

export type AuditActor = { id: string; name: string };
export type AuditResourceType = 'story' | 'event' | 'thread' | 'reply' | 'correction' | 'tip';

// Where each record kind lives and how its entry is labelled. Entries copy the label in, so they still
// read correctly after the record is deleted.
const SOURCES: Record<AuditResourceType, { from: string; id: string; label: string }> = {
  story: { from: 'news_articles', id: 'id', label: 'headline' },
  event: { from: 'events', id: 'id', label: 'title' },
  thread: { from: 'forum_threads', id: 'id', label: 'title' },
  reply: { from: 'forum_replies r JOIN forum_threads t ON t.id = r.thread_id', id: 'r.id', label: "'Reply in ' || t.title" },
  correction: { from: 'corrections', id: 'id', label: 'item_title' },
  tip: { from: 'news_submissions', id: 'id', label: "'News tip ' || id" },
};

const COLUMNS = '(id, actor_id, actor_name, target_type, target_id, target_label, action, detail, outcome, created_at)';

const clamp = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

/** An entry for a record you already have the title of (a new story, or one whose title just changed). */
export function auditResource(actor: AuditActor, resource: { type: AuditResourceType; id: string; label: string }, action: string, detail?: string) {
  return env.DB.prepare(`INSERT INTO admin_audit_log ${COLUMNS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)`)
    .bind(crypto.randomUUID(), actor.id, actor.name, resource.type, resource.id, clamp(resource.label, 200), action, detail ? clamp(detail, 500) : null, Date.now());
}

/**
 * An entry labelled from the record as it is now, written only while the record exists (and, when `also`
 * is given, while that extra condition holds). Put it in the same batch as the change and ahead of a
 * delete, so the entry is made if and only if the change finds its record.
 */
export function auditRecord(actor: AuditActor, type: AuditResourceType, id: string, action: string, detail?: string, also?: { sql: string; binds: unknown[] }) {
  const source = SOURCES[type];
  return env.DB.prepare(`
    INSERT INTO admin_audit_log ${COLUMNS}
    SELECT ?, ?, ?, ?, ${source.id}, substr(${source.label}, 1, 200), ?, ?, 'success', ? FROM ${source.from}
    WHERE ${source.id} = ?${also ? ` AND (${also.sql})` : ''}
  `).bind(crypto.randomUUID(), actor.id, actor.name, type, action, detail ? clamp(detail, 500) : null, Date.now(), id, ...(also?.binds ?? []));
}

/** Names of the entries of `fields` whose value differs between two versions of a record, in a readable list. */
export function changedFields(before: object, after: object, fields: Record<string, string>): string[] {
  const [from, to] = [before, after] as Record<string, unknown>[];
  return Object.keys(fields).filter((key) => from[key] !== to[key]).map((key) => fields[key]);
}

/**
 * A signed-in account that reached an admin endpoint without the role for it, or sent a cross-origin
 * request to it, recorded as a `denied` entry. People who aren't signed in leave no entry (there is no
 * one to attribute it to, and bots probing /api/admin would fill the log). An actor gets at most one
 * entry per action every ten minutes, so a script hammering an endpoint adds a row, not thousands.
 * A failure to write never changes the 403 the caller is about to send.
 */
export const DENIED_THROTTLE_MS = 10 * 60 * 1000;

export async function recordDenied(user: AuditActor | null, request: Request, action: string, reason: 'role' | 'origin', role: string | null = null): Promise<void> {
  if (!user) return;
  const now = Date.now();
  const detail = reason === 'role' ? `Needs a staff role this account lacks (account role: ${role ?? 'none'})` : 'Cross-origin request refused';
  try {
    await env.DB.prepare(`
      INSERT INTO admin_audit_log ${COLUMNS}
      SELECT ?, ?, ?, NULL, NULL, ?, ?, ?, 'denied', ?
      WHERE NOT EXISTS (SELECT 1 FROM admin_audit_log WHERE actor_id = ? AND action = ? AND outcome = 'denied' AND created_at > ?)
    `).bind(crypto.randomUUID(), user.id, user.name, clamp(new URL(request.url).pathname, 200), action, detail, now, user.id, action, now - DENIED_THROTTLE_MS).run();
  } catch {
    console.error(JSON.stringify({ event: 'audit_denied_write_failed', action }));
  }
}

/** The 403 an admin endpoint answers with, after recording the attempt. */
export async function denyAdmin(
  locals: { user: AuditActor | null; staffRole: string | null },
  request: Request,
  action: string,
  reason: 'role' | 'origin',
): Promise<Response> {
  await recordDenied(locals.user, request, action, reason, locals.staffRole);
  return new Response(reason === 'role' ? 'Forbidden' : 'Invalid request origin', { status: 403 });
}
