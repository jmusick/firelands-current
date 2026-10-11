/**
 * Alerts on authentication security events. The `auth_event` lines in Workers Logs (auth-events.ts) are for
 * looking things up after the fact; nothing reads them for you. So the sign-in path also adds to small
 * counters in D1, and the five-minute scheduled Worker (src/worker.ts) checks them, emails the owner when a
 * pattern crosses its threshold, and deletes old rows.
 *
 * What a counter holds: a five-minute bucket, the kind of event, and the keyed hashes of the email address
 * (`account`) and IP address (`client`) that auth-events.ts already logs. Never an email, IP, token, or
 * anything a person typed. An alert email carries the pattern, counts, window, and the first eight
 * characters of a hash, which is enough to search Workers Logs for the full lines.
 */

const MINUTE_MS = 60 * 1000;
export const BUCKET_MS = 5 * MINUTE_MS;

// ---- Thresholds. Each is "this many or more inside the window", counted over whole five-minute buckets. ----

/** Failed sign-ins against one email address (the same `account` hash). Slow guessing at one person's password. */
export const ACCOUNT_FAILURE_THRESHOLD = 10;
export const ACCOUNT_FAILURE_WINDOW_MS = 30 * MINUTE_MS;
/** Failed sign-ins from one network (the same `client` hash), whichever addresses it tried. */
export const CLIENT_FAILURE_THRESHOLD = 20;
export const CLIENT_FAILURE_WINDOW_MS = 30 * MINUTE_MS;
/** Requests the auth throttle refused (429 / RATE_LIMITED) across all clients; a flood the throttle is absorbing. */
export const RATE_LIMITED_THRESHOLD = 50;
export const RATE_LIMITED_WINDOW_MS = 15 * MINUTE_MS;
/** Password changes, successful or refused. Rare on a local newspaper, and what an account takeover does. */
export const PASSWORD_CHANGE_THRESHOLD = 5;
export const PASSWORD_CHANGE_WINDOW_MS = 60 * MINUTE_MS;
/** Account deletion requests, successful or refused. Self-service deletion is off, so any run of them is odd. */
export const ACCOUNT_DELETE_THRESHOLD = 3;
export const ACCOUNT_DELETE_WINDOW_MS = 60 * MINUTE_MS;
/** `denied` entries in the admin audit log (a signed-in account reached an admin endpoint it has no role for). */
export const ADMIN_DENIED_THRESHOLD = 3;
export const ADMIN_DENIED_WINDOW_MS = 60 * MINUTE_MS;

/** After an alert condition fires it stays quiet this long, however long the burst lasts. */
export const ALERT_COOLDOWN_MS = 60 * MINUTE_MS;
/** Counter and cooldown rows older than this are deleted. Longer than every window and the cooldown above. */
export const ALERT_RETENTION_MS = 24 * 60 * MINUTE_MS;
/** Rows kept per five-minute bucket (past it only existing rows and totals count), so a flood of made-up addresses can't grow the table without bound. */
export const MAX_HASH_COUNTERS_PER_BUCKET = 500;
/** Hashes listed per pattern in one email. */
const MAX_HASHES_LISTED = 5;
/** Characters of a hash shown in an alert (the log lines carry all 16). */
const HASH_PREFIX = 8;

export type CounterKind = 'sign_in_failure' | 'rate_limited' | 'password_change' | 'account_delete';
export type AuthCountable = { type: string; outcome: 'success' | 'failure'; status?: number; code?: string; account?: string; client?: string };

const HASH = /^[0-9a-f]{16}$/;
const bucketStart = (time: number) => Math.floor(time / BUCKET_MS) * BUCKET_MS;

/** The counter an event adds to, if any. A throttled request counts as throttled whichever endpoint it hit. */
export function counterKind(event: Pick<AuthCountable, 'type' | 'outcome' | 'status' | 'code'>): CounterKind | null {
  if (event.outcome === 'failure' && (event.status === 429 || event.code === 'RATE_LIMITED')) return 'rate_limited';
  if (event.type === 'sign_in' && event.outcome === 'failure') return 'sign_in_failure';
  if (event.type === 'password_change') return 'password_change';
  if (event.type === 'account_delete') return 'account_delete';
  return null;
}

// Which hashes each kind is counted under. A kind with neither is a plain total (the spike patterns).
const TRACKS: Record<CounterKind, { account: boolean; client: boolean }> = {
  sign_in_failure: { account: true, client: true },
  rate_limited: { account: false, client: true },
  password_change: { account: false, client: false },
  account_delete: { account: false, client: false },
};

/**
 * Adds one event to its counter with a single upsert: one D1 row written, one statement, no extra hashing
 * (the hashes are the ones auth-events.ts has just computed for the log line). The per-account, per-client
 * and total counts are all sums over these rows. A row carrying a hash is only created while the bucket holds
 * fewer than MAX_HASH_COUNTERS_PER_BUCKET rows (existing ones keep counting), so the cost of any burst is
 * bounded; totals-only rows are always kept. Callers treat a failure as non-fatal.
 */
export async function countAuthEvent(db: D1Database, event: AuthCountable, now = Date.now()): Promise<void> {
  const kind = counterKind(event);
  if (!kind) return;
  const tracks = TRACKS[kind];
  const account = tracks.account && event.account && HASH.test(event.account) ? event.account : '';
  const client = tracks.client && event.client && HASH.test(event.client) ? event.client : '';
  await db.prepare(`INSERT INTO auth_event_counters (bucket, kind, account, client, count)
    SELECT ?1, ?2, ?3, ?4, 1
    WHERE (?3 = '' AND ?4 = '')
      OR EXISTS (SELECT 1 FROM auth_event_counters WHERE bucket = ?1 AND kind = ?2 AND account = ?3 AND client = ?4)
      OR (SELECT COUNT(*) FROM auth_event_counters WHERE bucket = ?1) < ?5
    ON CONFLICT (bucket, kind, account, client) DO UPDATE SET count = count + 1`)
    .bind(bucketStart(now), kind, account, client, MAX_HASH_COUNTERS_PER_BUCKET).run();
}

/** Deletes counters and cooldown records older than ALERT_RETENTION_MS. */
export async function pruneAuthAlerts(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM auth_event_counters WHERE bucket < ?').bind(bucketStart(now - ALERT_RETENTION_MS)),
    db.prepare('DELETE FROM auth_alert_state WHERE last_alert_at < ?').bind(now - ALERT_RETENTION_MS),
  ]);
}

// ---- Finding patterns ----

type Finding = {
  /** Dedupe key: the pattern, plus the hash for per-account and per-client patterns. */
  key: string;
  pattern: string;
  title: string;
  count: number;
  windowMs: number;
  /** Eight-character hash prefix, for patterns about one account or client. */
  hash?: string;
  where: string;
  lines: string[];
};

const WORKERS_LOGS = 'Cloudflare dashboard > Workers & Pages > firelands-current > Observability (Workers Logs)';
const minutes = (windowMs: number) => `${windowMs / MINUTE_MS} minutes`;
const sinceBucket = (now: number, windowMs: number) => bucketStart(now - windowMs);

async function hashesOver(db: D1Database, kind: CounterKind, by: 'account' | 'client', threshold: number, windowMs: number, now: number) {
  // `by` is one of the two column names above, never request input.
  const { results } = await db.prepare(`SELECT ${by} AS hash, SUM(count) AS total FROM auth_event_counters
    WHERE kind = ? AND ${by} != '' AND bucket >= ? GROUP BY ${by} HAVING total >= ? ORDER BY total DESC LIMIT ?`)
    .bind(kind, sinceBucket(now, windowMs), threshold, MAX_HASHES_LISTED).all<{ hash: string; total: number }>();
  return results;
}

async function totalOf(db: D1Database, kind: CounterKind, windowMs: number, now: number): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM auth_event_counters WHERE kind = ? AND bucket >= ?')
    .bind(kind, sinceBucket(now, windowMs)).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function findPatterns(db: D1Database, now = Date.now()): Promise<Finding[]> {
  const findings: Finding[] = [];
  const signInFilter = 'event = auth_event, type = sign_in, outcome = failure';

  for (const { hash, total } of await hashesOver(db, 'sign_in_failure', 'account', ACCOUNT_FAILURE_THRESHOLD, ACCOUNT_FAILURE_WINDOW_MS, now)) {
    const short = hash.slice(0, HASH_PREFIX);
    findings.push({
      key: `account_failures:${hash}`, pattern: 'Many failed sign-ins for one account', count: total, windowMs: ACCOUNT_FAILURE_WINDOW_MS, hash: short,
      title: `${total} failed sign-ins for account ${short}`,
      where: `${signInFilter}, then search the "account" field for ${short}`,
      lines: [`${total} failed sign-ins against one email address (account hash ${short}...) in ${minutes(ACCOUNT_FAILURE_WINDOW_MS)}; the threshold is ${ACCOUNT_FAILURE_THRESHOLD}.`],
    });
  }
  for (const { hash, total } of await hashesOver(db, 'sign_in_failure', 'client', CLIENT_FAILURE_THRESHOLD, CLIENT_FAILURE_WINDOW_MS, now)) {
    const short = hash.slice(0, HASH_PREFIX);
    findings.push({
      key: `client_failures:${hash}`, pattern: 'Many failed sign-ins from one client', count: total, windowMs: CLIENT_FAILURE_WINDOW_MS, hash: short,
      title: `${total} failed sign-ins from client ${short}`,
      where: `${signInFilter}, then search the "client" field for ${short}`,
      lines: [`${total} failed sign-ins from one network (client hash ${short}...) in ${minutes(CLIENT_FAILURE_WINDOW_MS)}; the threshold is ${CLIENT_FAILURE_THRESHOLD}.`],
    });
  }

  const throttled = await totalOf(db, 'rate_limited', RATE_LIMITED_WINDOW_MS, now);
  if (throttled >= RATE_LIMITED_THRESHOLD) {
    const clients = await hashesOver(db, 'rate_limited', 'client', 1, RATE_LIMITED_WINDOW_MS, now);
    findings.push({
      key: 'rate_limited', pattern: 'Burst of throttled sign-in requests', count: throttled, windowMs: RATE_LIMITED_WINDOW_MS,
      title: `${throttled} throttled auth requests`,
      where: 'event = auth_event, code = RATE_LIMITED',
      lines: [
        `${throttled} requests were refused by the auth throttle (RATE_LIMITED) in ${minutes(RATE_LIMITED_WINDOW_MS)}; the threshold is ${RATE_LIMITED_THRESHOLD}.`,
        ...(clients.length ? [`Busiest clients: ${clients.map((c) => `${c.hash.slice(0, HASH_PREFIX)}... (${c.total})`).join(', ')}.`] : []),
      ],
    });
  }

  const spikes: [CounterKind, string, string, number, number][] = [
    ['password_change', 'Spike of password changes', 'type = password_change', PASSWORD_CHANGE_THRESHOLD, PASSWORD_CHANGE_WINDOW_MS],
    ['account_delete', 'Spike of account deletion requests', 'type = account_delete', ACCOUNT_DELETE_THRESHOLD, ACCOUNT_DELETE_WINDOW_MS],
  ];
  for (const [kind, pattern, filter, threshold, windowMs] of spikes) {
    const total = await totalOf(db, kind, windowMs, now);
    if (total < threshold) continue;
    findings.push({
      key: kind, pattern, count: total, windowMs, title: `${total} ${kind.replace('_', ' ')} events`,
      where: `event = auth_event, ${filter}`,
      lines: [`${total} ${kind.replace('_', ' ')} events (successful or refused) in ${minutes(windowMs)}; the threshold is ${threshold}.`],
    });
  }

  const since = now - ADMIN_DENIED_WINDOW_MS;
  const denied = await db.prepare("SELECT COUNT(*) AS count, COUNT(DISTINCT actor_id) AS actors FROM admin_audit_log WHERE outcome = 'denied' AND created_at >= ?")
    .bind(since).first<{ count: number; actors: number }>();
  if (denied && denied.count >= ADMIN_DENIED_THRESHOLD) {
    const { results } = await db.prepare("SELECT action, COUNT(*) AS count FROM admin_audit_log WHERE outcome = 'denied' AND created_at >= ? GROUP BY action ORDER BY count DESC LIMIT 3")
      .bind(since).all<{ action: string; count: number }>();
    findings.push({
      key: 'admin_denied', pattern: 'Denied admin requests', count: denied.count, windowMs: ADMIN_DENIED_WINDOW_MS,
      title: `${denied.count} denied admin requests`,
      where: 'the administrator audit log at /admin/users/log (entries marked denied), not Workers Logs',
      lines: [
        `${denied.count} denied entries from ${denied.actors} signed-in account${denied.actors === 1 ? '' : 's'} in ${minutes(ADMIN_DENIED_WINDOW_MS)}; the threshold is ${ADMIN_DENIED_THRESHOLD}.`,
        ...(results.length ? [`Actions: ${results.map((row) => `${row.action} (${row.count})`).join(', ')}.`] : []),
      ],
    });
  }
  return findings;
}

// ---- Once per cooldown ----

/** Marks `key` as alerted at `now` unless it alerted within the cooldown. Returns the earlier time, or null when not claimed. */
async function claim(db: D1Database, key: string, now: number): Promise<number | null> {
  const before = await db.prepare('SELECT last_alert_at FROM auth_alert_state WHERE alert_key = ?').bind(key).first<{ last_alert_at: number }>();
  const result = await db.prepare(`INSERT INTO auth_alert_state (alert_key, last_alert_at) VALUES (?1, ?2)
    ON CONFLICT (alert_key) DO UPDATE SET last_alert_at = ?2 WHERE auth_alert_state.last_alert_at <= ?2 - ?3`)
    .bind(key, now, ALERT_COOLDOWN_MS).run();
  return result.meta.changes ? before?.last_alert_at ?? 0 : null;
}

/** Hands a claim back (the email didn't go out) so the next run tries again. */
function release(db: D1Database, key: string, now: number, earlier: number) {
  return db.prepare('UPDATE auth_alert_state SET last_alert_at = ? WHERE alert_key = ? AND last_alert_at = ?').bind(earlier, key, now).run();
}

export type AlertDelivery = { to: string; subject: string; text: string };
export type AlertOptions = {
  /** SECURITY_ALERT_EMAIL; with none (or one that isn't an address) the alert is logged instead of mailed. */
  recipient?: string;
  send: (mail: AlertDelivery) => Promise<void>;
  now?: number;
};
export type AlertResult = { alerts: string[]; delivery: 'none' | 'email' | 'log' | 'email_failed' };

/** The plain-text body: patterns, counts, windows, truncated hashes, and where to look. */
export function alertText(findings: Finding[]): string {
  const sections = findings.map((finding) => [
    `${finding.pattern.toUpperCase()}`,
    ...finding.lines,
    `Window: the last ${minutes(finding.windowMs)}.`,
    `Where to look: ${finding.where}.`,
  ].join('\n'));
  return [
    'Firelands Current noticed unusual authentication activity.',
    '',
    sections.join('\n\n'),
    '',
    `Workers Logs: ${WORKERS_LOGS}. Filter by the fields above; hashes are keyed, so they identify an address or network only to someone with the logs, and no email address or IP address appears in this message.`,
    `You will not get another alert for the same condition for ${ALERT_COOLDOWN_MS / MINUTE_MS} minutes.`,
  ].join('\n');
}

/**
 * The scheduled entry point, called from every cron run. Finds patterns over their thresholds, takes each
 * one's cooldown claim (so a pattern alerts once per ALERT_COOLDOWN_MS however long it lasts, even across
 * overlapping runs), and sends everything newly claimed as one email. With no recipient configured the same
 * content is logged as a single `security_alert` line. If the send fails the claims are handed back so the
 * next run tries again.
 */
export async function runAuthAlerts(db: D1Database, options: AlertOptions): Promise<AlertResult> {
  const now = options.now ?? Date.now();
  const claimed: { finding: Finding; earlier: number }[] = [];
  for (const finding of await findPatterns(db, now)) {
    const earlier = await claim(db, finding.key, now);
    if (earlier !== null) claimed.push({ finding, earlier });
  }
  if (!claimed.length) return { alerts: [], delivery: 'none' };

  const findings = claimed.map((entry) => entry.finding);
  const summary = findings.map(({ pattern, count, windowMs, hash }) => ({ pattern, count, window_minutes: windowMs / MINUTE_MS, ...(hash ? { hash } : {}) }));
  const recipient = options.recipient?.trim();
  let delivery: AlertResult['delivery'] = 'log';
  if (recipient && /^[^\s@]+@[^\s@]+$/.test(recipient)) {
    const subject = findings.length === 1 ? `Security alert: ${findings[0].title}` : `Security alert: ${findings.length} patterns on Firelands Current`;
    try {
      await options.send({ to: recipient, subject, text: alertText(findings) });
      delivery = 'email';
    } catch {
      delivery = 'email_failed';
      await Promise.all(claimed.map(({ finding, earlier }) => release(db, finding.key, now, earlier).catch(() => {})));
    }
  }
  (delivery === 'email_failed' ? console.error : console.warn)(JSON.stringify({ event: delivery === 'email_failed' ? 'security_alert_send_failed' : 'security_alert', delivery, alerts: summary }));
  return { alerts: findings.map((finding) => finding.key), delivery };
}
