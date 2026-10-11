-- Counters behind the authentication alerts (src/lib/auth-alerts.ts). The sign-in path adds to them as events
-- happen; the five-minute cron reads them, emails the owner when a pattern crosses its threshold, and deletes
-- rows after a day. They hold only the keyed hashes already written to Workers Logs (never an email address,
-- IP address, token, or text anyone submitted).

-- One row per five-minute bucket (Unix ms at the bucket's start), kind of event, and the keyed hash of the
-- email address (account) and of the IP address (client) it involved, each '' when not tracked for that kind.
-- A failure is therefore one upsert; the per-account, per-client and total counts are sums over these rows.
CREATE TABLE auth_event_counters (
  bucket INTEGER NOT NULL,
  kind TEXT NOT NULL,
  account TEXT NOT NULL,
  client TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, kind, account, client)
) WITHOUT ROWID;

-- When each alert condition last fired, so a sustained burst sends one email per cooldown, not one per run.
-- alert_key is the pattern, plus the hash for the per-account and per-client patterns.
CREATE TABLE auth_alert_state (
  alert_key TEXT PRIMARY KEY,
  last_alert_at INTEGER NOT NULL
) WITHOUT ROWID;
