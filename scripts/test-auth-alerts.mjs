import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Authentication security alerts (src/lib/auth-alerts.ts) against the real migrations: counters written by the
// real sign-in logging path, a synthetic burst producing exactly one alert, normal traffic none, the cooldown,
// the cap on counters, pruning, what the counters and emails may contain, and the scheduled Worker running the
// alert check on every cron run while the tip-retention job still runs once a day.
const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
function execute(statement, values) {
  if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
  return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
}
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    let values = [];
    const query = {
      bind(...args) { values = args; return query; },
      sync: () => execute(statement, values),
      async run() { return query.sync(); },
      async all() { return query.sync(); },
      async first() { return query.sync().results[0] ?? null; },
    };
    return query;
  },
  // A D1 batch is one transaction.
  async batch(statements) {
    database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.sync());
      database.exec('COMMIT');
      return results;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  },
};
globalThis.__alertTestEnv = { DB: db, BETTER_AUTH_SECRET: 'alert-regression-secret-at-least-32-characters' };
const stubEnv = 'data:text/javascript,export const env = globalThis.__alertTestEnv;';
function sourceModule(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? stubEnv : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const alertsUrl = sourceModule('src/lib/auth-alerts.ts');
const alerts = await import(alertsUrl);
const { fingerprint, handleAuthRequest } = await import(sourceModule('src/lib/auth-events.ts', { './auth-alerts': alertsUrl }));
const { countAuthEvent, runAuthAlerts, pruneAuthAlerts, counterKind, ALERT_COOLDOWN_MS, ALERT_RETENTION_MS, BUCKET_MS, MAX_HASH_COUNTERS_PER_BUCKET,
  ACCOUNT_FAILURE_THRESHOLD, CLIENT_FAILURE_THRESHOLD, RATE_LIMITED_THRESHOLD, PASSWORD_CHANGE_THRESHOLD, ACCOUNT_DELETE_THRESHOLD, ADMIN_DENIED_THRESHOLD,
  ACCOUNT_FAILURE_WINDOW_MS } = alerts;

// The scheduled Worker, with the Astro handler, the Facebook publisher and the mail sender replaced.
globalThis.__alertTestMail = [];
globalThis.__alertTestFacebookRuns = 0;
const worker = (await import(sourceModule('src/worker.ts', {
  '@astrojs/cloudflare/handler': 'data:text/javascript,export const handle = () => new Response("page");',
  './lib/auth-alerts': alertsUrl,
  './lib/auth-rate-limit': sourceModule('src/lib/auth-rate-limit.ts'),
  './lib/tip-retention': sourceModule('src/lib/tip-retention.ts'),
  './lib/facebook-publisher': 'data:text/javascript,export const publishFacebookStories = async () => { globalThis.__alertTestFacebookRuns++; };',
  './lib/mail': 'data:text/javascript,export const sendSecurityAlertMail = async (mail) => { globalThis.__alertTestMail.push(mail); };',
}))).default;

const NOW = Date.UTC(2026, 9, 11, 12, 2, 0);
const MINUTE = 60 * 1000;
const hex = (n) => n.toString(16).padStart(16, '0');
const sent = [];
const send = async (mail) => { sent.push(mail); };
const options = (extra = {}) => ({ recipient: 'owner@example.test', send, now: NOW, ...extra });

/** Runs `fn` with console output captured, returning the JSON lines it wrote. */
async function capture(fn) {
  const lines = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ['log', 'warn', 'error']) console[level] = (line) => lines.push({ level, line: typeof line === 'string' ? line : JSON.stringify(line) });
  try { await fn(); } finally { Object.assign(console, originals); }
  return lines.map(({ level, line }) => { try { return { level, ...JSON.parse(line) }; } catch { return { level, text: line }; } });
}
function reset() {
  database.exec('DELETE FROM auth_event_counters; DELETE FROM auth_alert_state; DELETE FROM admin_audit_log; DELETE FROM news_submissions');
  database.exec("UPDATE scheduled_jobs SET last_run_at = 0");
  sent.length = 0;
  globalThis.__alertTestMail.length = 0;
  globalThis.__alertTestFacebookRuns = 0;
}
const rows = (table) => database.prepare(`SELECT * FROM ${table}`).all();
const failure = (account, client, type = 'sign_in') => ({ type, outcome: 'failure', status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', account, client });
async function many(count, event, now = NOW) { for (let i = 0; i < count; i++) await countAuthEvent(db, typeof event === 'function' ? event(i) : event, now); }
function denied(count, createdAt = NOW) {
  for (let i = 0; i < count; i++) {
    database.prepare('INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run(`user-${i}`, `Staff ${i}`, `staff${i}@example.test`, '2026-01-01', '2026-01-01');
    database.prepare("INSERT INTO admin_audit_log (id, actor_id, actor_name, target_type, target_id, target_label, action, detail, outcome, created_at) VALUES (?, ?, 'Someone', NULL, NULL, '/api/admin/news/save', ?, 'Needs a staff role this account lacks', 'denied', ?)")
      .run(`denied-${i}-${createdAt}`, `user-${i}`, `news-save-${i % 2}`, createdAt - i * 1000);
  }
}

test('a synthetic burst of failed sign-ins through the real logging path produces exactly one alert', async () => {
  reset();
  const handler = async () => new Response(JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const victim = 'victim.person@example.test';
  await capture(async () => {
    for (let i = 0; i < ACCOUNT_FAILURE_THRESHOLD + 2; i++) {
      // One address attacked from many networks, so only the per-account pattern is over its threshold.
      const response = await handleAuthRequest(handler, new Request('https://firelandscurrent.com/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${i + 1}` },
        body: JSON.stringify({ email: victim, password: 'not-the-password' }),
      }));
      assert.equal(response.status, 401);
    }
  });
  const accountHash = await fingerprint('email', victim);
  const result = await runAuthAlerts(db, { recipient: 'owner@example.test', send, now: Date.now() });
  assert.deepEqual(result.alerts, [`account_failures:${accountHash}`]);
  assert.equal(result.delivery, 'email');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.test');
  assert.match(sent[0].subject, /^Security alert: 12 failed sign-ins for account /);
  assert.ok(sent[0].text.includes(accountHash.slice(0, 8)));
  assert.ok(!sent[0].text.includes(accountHash), 'only a hash prefix is mailed');
  assert.ok(sent[0].text.includes('Workers Logs'));
  assert.ok(sent[0].text.includes('Window: the last 30 minutes'));
});

test('normal traffic produces no alert', async () => {
  reset();
  // A few typos, ordinary successes, one password change, a stray throttled request: all under every threshold.
  await many(ACCOUNT_FAILURE_THRESHOLD - 1, failure(hex(1), hex(100)));
  await many(3, failure(hex(2), hex(101)));
  await many(RATE_LIMITED_THRESHOLD - 1, { type: 'sign_in', outcome: 'failure', status: 429, code: 'RATE_LIMITED', client: hex(102) });
  await many(PASSWORD_CHANGE_THRESHOLD - 1, { type: 'password_change', outcome: 'success' });
  await many(ACCOUNT_DELETE_THRESHOLD - 1, { type: 'account_delete', outcome: 'failure', status: 403 });
  await many(40, { type: 'sign_in', outcome: 'success' });
  await many(20, { type: 'sign_up', outcome: 'success' });
  denied(ADMIN_DENIED_THRESHOLD - 1);
  const result = await runAuthAlerts(db, options());
  assert.deepEqual(result, { alerts: [], delivery: 'none' });
  assert.equal(sent.length, 0);
  assert.equal(rows('auth_alert_state').length, 0);
});

test('successful sign-ins and unrelated events add no counters', async () => {
  reset();
  await many(5, { type: 'sign_in', outcome: 'success', account: hex(1), client: hex(2) });
  await many(5, { type: 'sign_out', outcome: 'success', client: hex(2) });
  assert.equal(rows('auth_event_counters').length, 0);
  assert.equal(counterKind({ type: 'sign_in', outcome: 'failure', status: 401 }), 'sign_in_failure');
  assert.equal(counterKind({ type: 'sign_up', outcome: 'failure', status: 429 }), 'rate_limited');
  assert.equal(counterKind({ type: 'sign_up', outcome: 'failure', status: 400 }), null);
});

test('one client failing across many addresses alerts once, as the client pattern', async () => {
  reset();
  await many(CLIENT_FAILURE_THRESHOLD + 5, (i) => failure(hex(1000 + i), hex(7)));
  const result = await runAuthAlerts(db, options());
  assert.deepEqual(result.alerts, [`client_failures:${hex(7)}`]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /MANY FAILED SIGN-INS FROM ONE CLIENT/);
});

test('a burst of throttled requests, and spikes of password changes and account deletions, alert together in one email', async () => {
  reset();
  await many(RATE_LIMITED_THRESHOLD + 10, (i) => ({ type: i % 2 ? 'sign_in' : 'sign_up', outcome: 'failure', status: 429, code: 'RATE_LIMITED', client: hex(i % 3) }));
  await many(PASSWORD_CHANGE_THRESHOLD, { type: 'password_change', outcome: 'success' });
  await many(ACCOUNT_DELETE_THRESHOLD, { type: 'account_delete', outcome: 'failure', status: 403, code: 'REAUTH_REQUIRED' });
  denied(ADMIN_DENIED_THRESHOLD);
  const result = await runAuthAlerts(db, options());
  assert.deepEqual([...result.alerts].sort(), ['account_delete', 'admin_denied', 'password_change', 'rate_limited']);
  assert.equal(sent.length, 1, 'newly claimed alerts go out as one email');
  assert.match(sent[0].subject, /4 patterns/);
  for (const heading of ['BURST OF THROTTLED', 'SPIKE OF PASSWORD CHANGES', 'SPIKE OF ACCOUNT DELETION', 'DENIED ADMIN REQUESTS']) assert.ok(sent[0].text.includes(heading), heading);
  assert.match(sent[0].text, /3 denied entries from 3 signed-in accounts/);
  assert.match(sent[0].text, /\/admin\/users\/log/);
});

test('a second run inside the cooldown sends nothing, even while the burst continues; it alerts again after the cooldown', async () => {
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, (i) => failure(hex(1), hex(300 + i)));
  assert.equal((await runAuthAlerts(db, options())).alerts.length, 1);
  assert.equal((await runAuthAlerts(db, options({ now: NOW + 5 * MINUTE }))).alerts.length, 0);
  // The burst goes on.
  await many(20, (i) => failure(hex(1), hex(400 + i)), NOW + 10 * MINUTE);
  assert.equal((await runAuthAlerts(db, options({ now: NOW + 15 * MINUTE }))).alerts.length, 0);
  assert.equal((await runAuthAlerts(db, options({ now: NOW + ALERT_COOLDOWN_MS - MINUTE }))).alerts.length, 0);
  assert.equal(sent.length, 1);
  // Still going after the cooldown: one more.
  await many(ACCOUNT_FAILURE_THRESHOLD, (i) => failure(hex(1), hex(500 + i)), NOW + ALERT_COOLDOWN_MS + MINUTE);
  assert.equal((await runAuthAlerts(db, options({ now: NOW + ALERT_COOLDOWN_MS + 2 * MINUTE }))).alerts.length, 1);
  assert.equal(sent.length, 2);
});

test('overlapping runs cannot both claim the same alert', async () => {
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
  const results = await Promise.all([runAuthAlerts(db, options()), runAuthAlerts(db, options())]);
  assert.equal(results.flatMap((result) => result.alerts).length, 1);
  assert.equal(sent.length, 1);
});

test('a different account over its threshold still alerts while another is cooling down', async () => {
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
  await runAuthAlerts(db, options());
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(9), hex(3)), NOW + 6 * MINUTE);
  const result = await runAuthAlerts(db, options({ now: NOW + 7 * MINUTE }));
  assert.deepEqual(result.alerts, [`account_failures:${hex(9)}`]);
});

test('failures older than the window do not count', async () => {
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
  assert.equal((await runAuthAlerts(db, options({ now: NOW + ACCOUNT_FAILURE_WINDOW_MS + 2 * BUCKET_MS }))).alerts.length, 0);
});

test('with no recipient the alert is logged as one security_alert line, once per cooldown', async () => {
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
  await many(CLIENT_FAILURE_THRESHOLD, failure(hex(3), hex(4)));
  const first = await capture(() => runAuthAlerts(db, options({ recipient: undefined })));
  const lines = first.filter((line) => line.event === 'security_alert');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].delivery, 'log');
  assert.equal(lines[0].alerts.length, 3);
  assert.equal(sent.length, 0);
  for (const alert of lines[0].alerts) assert.ok(!alert.hash || alert.hash.length === 8);
  const second = await capture(() => runAuthAlerts(db, options({ recipient: '', now: NOW + MINUTE })));
  assert.equal(second.filter((line) => line.event === 'security_alert').length, 0);
  // A value that isn't an address is treated as unset rather than handed to the mail service.
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
  await capture(() => runAuthAlerts(db, options({ recipient: 'not an address' })));
  assert.equal(sent.length, 0);
});

test('a failed send hands the claim back so the next run retries', async () => {
  reset();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
  const lines = await capture(async () => {
    const result = await runAuthAlerts(db, options({ send: async () => { throw new Error('mail service down'); } }));
    assert.equal(result.delivery, 'email_failed');
  });
  assert.ok(lines.some((line) => line.event === 'security_alert_send_failed'));
  const retry = await runAuthAlerts(db, options({ now: NOW + MINUTE }));
  assert.equal(retry.delivery, 'email');
  assert.equal(sent.length, 1);
});

test('counters and alert emails never hold an email address, IP address, or full hash', async () => {
  reset();
  const emails = ['target@example.test', 'someone.else@example.org'];
  const ips = ['203.0.113.77', '2001:db8::1234'];
  await capture(async () => {
    for (let i = 0; i < ACCOUNT_FAILURE_THRESHOLD + CLIENT_FAILURE_THRESHOLD + 5; i++) {
      await handleAuthRequest(async () => new Response(JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }), { status: 401 }), new Request('https://firelandscurrent.com/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ips[i % 2] },
        body: JSON.stringify({ email: emails[i % 2], password: 'secret-password-value' }),
      }));
    }
  });
  const dump = JSON.stringify([rows('auth_event_counters'), rows('auth_alert_state')]);
  const result = await runAuthAlerts(db, { recipient: 'owner@example.test', send, now: Date.now() });
  assert.ok(result.alerts.length >= 2, 'both patterns fired');
  const mailText = sent.map((mail) => `${mail.subject}\n${mail.text}`).join('\n');
  for (const secret of [...emails, ...ips, 'secret-password-value', 'example.org']) {
    assert.ok(!dump.includes(secret), `counters hold ${secret}`);
    assert.ok(!mailText.includes(secret), `mail holds ${secret}`);
  }
  assert.ok(!/@/.test(mailText.replace('owner@example.test', '')), 'no address in the email');
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(mailText), 'no IPv4 address in the email');
  assert.ok(!/[0-9a-f]{16}/.test(mailText), 'only hash prefixes in the email');
  for (const row of rows('auth_event_counters')) {
    for (const hash of [row.account, row.client]) assert.ok(hash === '' || /^[0-9a-f]{16}$/.test(hash), `unexpected hash ${hash}`);
    assert.ok(['sign_in_failure', 'rate_limited', 'password_change', 'account_delete'].includes(row.kind));
  }
  for (const row of rows('auth_alert_state')) assert.match(row.alert_key, /^(account_failures|client_failures):[0-9a-f]{16}$/);
});

test('a failure is one upsert and one row; counters are bounded per bucket, existing rows keep counting, totals are never dropped', async () => {
  reset();
  // One statement and one row per failed sign-in, and none for anything else (the Workers Free plan's D1 write budget).
  const prepared = [];
  const original = db.prepare;
  db.prepare = (sql) => { prepared.push(sql); return original.call(db, sql); };
  await countAuthEvent(db, failure(hex(1), hex(2)), NOW);
  await countAuthEvent(db, failure(hex(1), hex(2)), NOW);
  await countAuthEvent(db, { type: 'sign_in', outcome: 'success', account: hex(1), client: hex(2) }, NOW);
  db.prepare = original;
  assert.equal(prepared.length, 2);
  assert.deepEqual(rows('auth_event_counters').map((row) => row.count), [2]);
  reset();

  await many(MAX_HASH_COUNTERS_PER_BUCKET + 100, (i) => failure(hex(i + 1), hex(1)), NOW);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM auth_event_counters').get().n, MAX_HASH_COUNTERS_PER_BUCKET);
  await many(3, failure(hex(1), hex(1)), NOW);
  assert.equal(database.prepare('SELECT count FROM auth_event_counters WHERE account = ? AND client = ?').get(hex(1), hex(1)).count, 4, 'a tracked pair keeps counting past the cap');
  // Totals-only rows are exempt from the cap.
  await many(PASSWORD_CHANGE_THRESHOLD, { type: 'password_change', outcome: 'success' }, NOW);
  assert.equal(database.prepare("SELECT count FROM auth_event_counters WHERE kind = 'password_change'").get().count, PASSWORD_CHANGE_THRESHOLD);
  // A new bucket starts fresh.
  await many(2, failure(hex(9000), hex(9000)), NOW + BUCKET_MS);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM auth_event_counters WHERE bucket > ?').get(NOW).n, 1);
});

test('pruning removes old counters and cooldown records and leaves recent ones', async () => {
  reset();
  await many(3, failure(hex(1), hex(2)), NOW - ALERT_RETENTION_MS - 2 * BUCKET_MS);
  await many(3, failure(hex(3), hex(4)), NOW - 10 * MINUTE);
  database.prepare('INSERT INTO auth_alert_state (alert_key, last_alert_at) VALUES (?, ?), (?, ?)').run('account_failures:old', NOW - ALERT_RETENTION_MS - 1, 'account_failures:new', NOW - 30 * MINUTE);
  await pruneAuthAlerts(db, NOW);
  assert.deepEqual(rows('auth_event_counters').map((row) => [row.account, row.client]), [[hex(3), hex(4)]]);
  assert.ok(rows('auth_event_counters').every((row) => row.bucket >= NOW - ALERT_RETENTION_MS));
  assert.deepEqual(rows('auth_alert_state').map((row) => row.alert_key), ['account_failures:new']);
  await pruneAuthAlerts(db, NOW);
  assert.equal(rows('auth_alert_state').length, 1, 'pruning twice changes nothing more');
});

test('the scheduled Worker checks alerts on every run, and the retention job still runs once a day', async () => {
  reset();
  const env = { DB: db, SECURITY_ALERT_EMAIL: 'owner@example.test' };
  database.prepare(`INSERT INTO news_submissions (id, name, email, subject, body, credit_requested, status, decided_at, created_at, updated_at)
    VALUES ('old-declined', 'A Tipster', 'tipster@example.test', 'Old tip', 'Text', 0, 'declined', 1, 1, 1)`).run();
  const now = Date.now();
  await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)), now);

  const first = await capture(() => worker.scheduled({ cron: '*/5 * * * *' }, env));
  assert.equal(globalThis.__alertTestMail.length, 1, 'the alert went out');
  assert.equal(first.filter((line) => line.event === 'tip_retention_run').length, 1, 'retention ran');
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM news_submissions WHERE id = 'old-declined'").get().n, 0);

  // Five minutes later: the same burst, still cooling down, and retention not due again.
  const claimed = database.prepare("SELECT last_run_at FROM scheduled_jobs WHERE name = 'tip-retention'").get().last_run_at;
  const second = await capture(() => worker.scheduled({ cron: '*/5 * * * *' }, env));
  assert.equal(globalThis.__alertTestMail.length, 1, 'no second email for the same burst');
  assert.equal(second.filter((line) => line.event === 'tip_retention_run').length, 0, 'retention waits for the next day');
  assert.equal(database.prepare("SELECT last_run_at FROM scheduled_jobs WHERE name = 'tip-retention'").get().last_run_at, claimed);

  // A new pattern between runs is picked up by the next run.
  await many(CLIENT_FAILURE_THRESHOLD, failure(hex(50), hex(51)), Date.now());
  await capture(() => worker.scheduled({ cron: '*/5 * * * *' }, env));
  assert.equal(globalThis.__alertTestMail.length, 2);
  assert.equal(globalThis.__alertTestFacebookRuns, 3, 'the publisher ran each time');

  // A day on, retention is due again.
  database.prepare("UPDATE scheduled_jobs SET last_run_at = ? WHERE name = 'tip-retention'").run(claimed - 24 * 60 * MINUTE - 1);
  const third = await capture(() => worker.scheduled({ cron: '*/5 * * * *' }, env));
  assert.equal(third.filter((line) => line.event === 'tip_retention_run').length, 1);
});

test('an alert check that fails does not stop the retention job or the publisher', async () => {
  reset();
  database.exec('ALTER TABLE auth_alert_state RENAME TO auth_alert_state_gone');
  try {
    await many(ACCOUNT_FAILURE_THRESHOLD, failure(hex(1), hex(2)));
    const lines = await capture(() => worker.scheduled({ cron: '*/5 * * * *' }, { DB: db }));
    assert.ok(lines.some((line) => line.event === 'auth_alert_prune_failed' || line.event === 'auth_alerts_failed'));
    assert.equal(lines.filter((line) => line.event === 'tip_retention_run').length, 1);
    assert.equal(globalThis.__alertTestFacebookRuns, 1);
  } finally {
    database.exec('ALTER TABLE auth_alert_state_gone RENAME TO auth_alert_state');
  }
});

test('the cron stays at five minutes and the recipient is not committed', () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"crons":\s*\["\*\/5 \* \* \* \*"\]/);
  assert.ok(!/SECURITY_ALERT_EMAIL/.test(config), 'the address is a secret, not a committed var');
});
