import { DECLINED_TIP_RETENTION_MS, REPORTING_STATUSES, STALE_UNREAD_TIP_MS, TIP_CONTACT_RETENTION_MS, TIP_RETENTION_BATCH, TIP_RETENTION_INTERVAL_MS } from './tip-retention';

/**
 * How long submitted events are kept. The Privacy Policy and README quote these periods; they are the
 * news tip periods (src/lib/tip-retention.ts), applied to `event_submissions`, as the owner decided.
 *
 * - Declined submissions are deleted 90 days after they were declined.
 * - Reviewed submissions and ones converted to an event are kept, but the submitter's name, email and note
 *   to editors are removed a year after the decision. The event details stay, since an editor used or
 *   judged them, and a converted event is a separate record that is not touched.
 * - Unread submissions are never removed automatically; the queue flags ones older than 90 days.
 *
 * The clocks run from decided_at, the time of the latest status change, not from updated_at. This job has
 * its own daily claim in `scheduled_jobs`, so it neither depends on nor delays tip retention.
 */

export const DECLINED_SUBMISSION_RETENTION_MS = DECLINED_TIP_RETENTION_MS;
export const SUBMISSION_CONTACT_RETENTION_MS = TIP_CONTACT_RETENTION_MS;
/** Unread submissions older than this are flagged for review. Never deleted for age alone. */
export const STALE_UNREAD_SUBMISSION_MS = STALE_UNREAD_TIP_MS;
export const SUBMISSION_RETENTION_BATCH = TIP_RETENTION_BATCH;
export const SUBMISSION_RETENTION_INTERVAL_MS = TIP_RETENTION_INTERVAL_MS;

export type SubmissionRetentionResult = { deleted: number; anonymized: number; staleUnread: number; more: boolean };

const JOB = 'event-submission-retention';

/**
 * Applies both rules once, each to at most SUBMISSION_RETENTION_BATCH submissions, oldest decision first.
 * Running it again changes nothing until another submission comes due. Writes one audit entry with the
 * counts when anything changed: counts only, never titles, names, emails, notes or ids.
 */
export async function applyEventSubmissionRetention(db: D1Database, now = Date.now()): Promise<SubmissionRetentionResult> {
  const [deleted, anonymized] = await db.batch([
    db.prepare(`DELETE FROM event_submissions WHERE id IN (
      SELECT id FROM event_submissions WHERE status = 'declined' AND decided_at < ? ORDER BY decided_at LIMIT ?
    )`).bind(now - DECLINED_SUBMISSION_RETENTION_MS, SUBMISSION_RETENTION_BATCH),
    db.prepare(`UPDATE event_submissions SET name = '', email = '', note = '', anonymized_at = ?1, updated_at = ?1 WHERE id IN (
      SELECT id FROM event_submissions WHERE status IN ('reviewed', 'converted') AND anonymized_at IS NULL AND decided_at < ?2 ORDER BY decided_at LIMIT ?3
    )`).bind(now, now - SUBMISSION_CONTACT_RETENTION_MS, SUBMISSION_RETENTION_BATCH),
  ]);
  const stale = await db.prepare("SELECT COUNT(*) AS count FROM event_submissions WHERE status = 'unread' AND created_at < ?")
    .bind(now - STALE_UNREAD_SUBMISSION_MS).first<{ count: number }>();
  const result = {
    deleted: deleted.meta.changes ?? 0,
    anonymized: anonymized.meta.changes ?? 0,
    staleUnread: stale?.count ?? 0,
    more: false,
  };
  result.more = result.deleted === SUBMISSION_RETENTION_BATCH || result.anonymized === SUBMISSION_RETENTION_BATCH;
  if (result.deleted || result.anonymized) {
    const detail = [
      result.deleted && `Deleted ${plural(result.deleted, 'declined event submission')} past 90 days`,
      result.anonymized && `Removed submitter details from ${plural(result.anonymized, 'event submission')} decided over a year ago`,
    ].filter(Boolean).join('; ');
    await db.prepare(`INSERT INTO admin_audit_log (id, actor_id, actor_name, target_type, target_id, target_label, action, detail, outcome, created_at)
      VALUES (?, NULL, 'Scheduled retention', 'event-submission', NULL, 'Event submissions', 'event-submission-retention', ?, 'success', ?)`)
      .bind(crypto.randomUUID(), detail, now).run();
  }
  return result;
}

/**
 * The scheduled entry point, called from every five-minute cron run. It does the work at most once a day:
 * the first run claims the day by moving the job's last_run_at forward, and overlapping or later runs find
 * nothing to claim. A run that filled a batch, or failed, hands the claim back so the next cron run carries on.
 * Returns null when the job wasn't due.
 */
export async function runEventSubmissionRetention(db: D1Database, now = Date.now()): Promise<SubmissionRetentionResult | null> {
  const claim = await db.prepare('UPDATE scheduled_jobs SET last_run_at = ?1 WHERE name = ?2 AND last_run_at <= ?1 - ?3')
    .bind(now, JOB, SUBMISSION_RETENTION_INTERVAL_MS).run();
  if (!claim.meta.changes) return null;
  const release = () => db.prepare('UPDATE scheduled_jobs SET last_run_at = ? WHERE name = ? AND last_run_at = ?')
    .bind(now - SUBMISSION_RETENTION_INTERVAL_MS, JOB, now).run();
  let result: SubmissionRetentionResult;
  try {
    result = await applyEventSubmissionRetention(db, now);
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
  if (result.more) await release();
  console.log(JSON.stringify({ event: 'event_submission_retention_run', ...result }));
  return result;
}

/** When the retention rules will next act on a submission, for the queue. */
export function submissionRetentionDates(item: { status: string; decided_at: number | null; anonymized_at: number | null }): { deletesAt: number | null; anonymizesAt: number | null } {
  const decided = item.decided_at;
  return {
    deletesAt: item.status === 'declined' && decided !== null ? decided + DECLINED_SUBMISSION_RETENTION_MS : null,
    anonymizesAt: (REPORTING_STATUSES as readonly string[]).includes(item.status) && decided !== null && item.anonymized_at === null
      ? decided + SUBMISSION_CONTACT_RETENTION_MS : null,
  };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
