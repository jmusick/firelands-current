/**
 * How long news tips are kept. The Privacy Policy and README quote these periods.
 *
 * - Declined tips are deleted 90 days after they were declined. They aren't part of any reporting.
 * - Reviewed tips and tips converted to a story are the reporting record: their subject and text stay, but the
 *   submitter's name, email and account link are removed a year after the newsroom's decision, once
 *   follow-up questions and corrections have had time to come in.
 * - Unread tips are never removed automatically, since nobody has judged whether they matter yet. The inbox
 *   flags ones older than 90 days so an editor can review or decline them.
 * - Deleting an account deletes its unread and declined tips with it; its reviewed and converted tips stay as
 *   the reporting record, unlinked from the account, until the anonymization above.
 *
 * The clocks run from decided_at, the time of the latest status change, not from updated_at.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const DECLINED_TIP_RETENTION_MS = 90 * DAY_MS;
export const TIP_CONTACT_RETENTION_MS = 365 * DAY_MS;
/** Unread tips older than this are flagged for review. Never deleted for age alone. */
export const STALE_UNREAD_TIP_MS = 90 * DAY_MS;
/** Rows each rule touches per run, so one run stays well inside a scheduled Worker's limits. */
export const TIP_RETENTION_BATCH = 200;
export const TIP_RETENTION_INTERVAL_MS = DAY_MS;

/** Statuses whose tips are kept, without contact details after a year, as part of the reporting record. */
export const REPORTING_STATUSES = ['reviewed', 'converted'] as const;

export type TipRetentionResult = { deleted: number; anonymized: number; staleUnread: number; more: boolean };

const JOB = 'tip-retention';

/**
 * Applies both rules once, each to at most TIP_RETENTION_BATCH tips, oldest decision first. Running it
 * again changes nothing until another tip comes due. Writes one audit entry with the counts when anything
 * changed: counts only, never subjects, text, names, emails or tip ids.
 */
export async function applyTipRetention(db: D1Database, now = Date.now()): Promise<TipRetentionResult> {
  const [deleted, anonymized] = await db.batch([
    db.prepare(`DELETE FROM news_submissions WHERE id IN (
      SELECT id FROM news_submissions WHERE status = 'declined' AND decided_at < ? ORDER BY decided_at LIMIT ?
    )`).bind(now - DECLINED_TIP_RETENTION_MS, TIP_RETENTION_BATCH),
    db.prepare(`UPDATE news_submissions SET name = '', email = '', submitter_user_id = NULL, anonymized_at = ?1, updated_at = ?1 WHERE id IN (
      SELECT id FROM news_submissions WHERE status IN ('reviewed', 'converted') AND anonymized_at IS NULL AND decided_at < ?2 ORDER BY decided_at LIMIT ?3
    )`).bind(now, now - TIP_CONTACT_RETENTION_MS, TIP_RETENTION_BATCH),
  ]);
  const stale = await db.prepare("SELECT COUNT(*) AS count FROM news_submissions WHERE status = 'unread' AND created_at < ?")
    .bind(now - STALE_UNREAD_TIP_MS).first<{ count: number }>();
  const result = {
    deleted: deleted.meta.changes ?? 0,
    anonymized: anonymized.meta.changes ?? 0,
    staleUnread: stale?.count ?? 0,
    more: false,
  };
  result.more = result.deleted === TIP_RETENTION_BATCH || result.anonymized === TIP_RETENTION_BATCH;
  if (result.deleted || result.anonymized) {
    const detail = [
      result.deleted && `Deleted ${plural(result.deleted, 'declined tip')} past 90 days`,
      result.anonymized && `Removed submitter details from ${plural(result.anonymized, 'tip')} decided over a year ago`,
    ].filter(Boolean).join('; ');
    await db.prepare(`INSERT INTO admin_audit_log (id, actor_id, actor_name, target_type, target_id, target_label, action, detail, outcome, created_at)
      VALUES (?, NULL, 'Scheduled retention', 'tip', NULL, 'News tips', 'tip-retention', ?, 'success', ?)`)
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
export async function runTipRetention(db: D1Database, now = Date.now()): Promise<TipRetentionResult | null> {
  const claim = await db.prepare('UPDATE scheduled_jobs SET last_run_at = ?1 WHERE name = ?2 AND last_run_at <= ?1 - ?3')
    .bind(now, JOB, TIP_RETENTION_INTERVAL_MS).run();
  if (!claim.meta.changes) return null;
  const release = () => db.prepare('UPDATE scheduled_jobs SET last_run_at = ? WHERE name = ? AND last_run_at = ?')
    .bind(now - TIP_RETENTION_INTERVAL_MS, JOB, now).run();
  let result: TipRetentionResult;
  try {
    result = await applyTipRetention(db, now);
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
  if (result.more) await release();
  console.log(JSON.stringify({ event: 'tip_retention_run', ...result }));
  return result;
}

/**
 * Statements to run in the same batch as deleting an account, ahead of the delete. Unread and declined tips go
 * with the account. Reviewed and converted tips stay as the reporting record; the foreign key clears their
 * account link, and their name and email are removed on the usual schedule (or sooner, by an editor).
 */
export function deletedAccountTipStatements(db: D1Database, userId: string): D1PreparedStatement[] {
  return [db.prepare("DELETE FROM news_submissions WHERE submitter_user_id = ? AND status IN ('unread', 'declined')").bind(userId)];
}

/** When the retention rules will next act on a tip, for the inbox. */
export function tipRetentionDates(tip: { status: string; decided_at: number | null; anonymized_at: number | null }): { deletesAt: number | null; anonymizesAt: number | null } {
  const decided = tip.decided_at;
  return {
    deletesAt: tip.status === 'declined' && decided !== null ? decided + DECLINED_TIP_RETENTION_MS : null,
    anonymizesAt: (REPORTING_STATUSES as readonly string[]).includes(tip.status) && decided !== null && tip.anonymized_at === null
      ? decided + TIP_CONTACT_RETENTION_MS : null,
  };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
