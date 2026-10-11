import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// A throwaway in-memory database with the real migrations; nothing here touches the working D1 database.
const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
// Each statement waits a turn of the event loop, like a D1 round trip, so concurrent requests interleave
// between their queries the way Worker isolates sharing one database do. A batch is one transaction.
const turn = () => new Promise((resolve) => setImmediate(resolve));
const db = {
  prepare(sql) {
    let values = [];
    const statement = database.prepare(sql);
    const query = {
      bind(...args) { values = args; return query; },
      run_sync() { return { meta: statement.run(...values) }; },
      async run() { await turn(); return query.run_sync(); },
      async first() { await turn(); return statement.get(...values) ?? null; },
      async all() { await turn(); return { results: statement.all(...values) }; },
    };
    return query;
  },
  async batch(statements) {
    await turn();
    database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.run_sync());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

const emails = [];
const realFetch = globalThis.fetch;
globalThis.__quotaEnv = {
  DB: db, BETTER_AUTH_SECRET: 'quota-regression-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fixture-secret',
  EMAIL: { async send(message) { emails.push(message); return { messageId: 'fixture-message' }; } },
};
globalThis.fetch = async (url) => {
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  return Response.json({ success: true });
};
const stubEnv = 'data:text/javascript,export const env = globalThis.__quotaEnv;';
function sourceModule(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? stubEnv : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const rateModule = sourceModule('src/lib/auth-rate-limit.ts');
const quotasModule = sourceModule('src/lib/quotas.ts', { './auth-rate-limit': rateModule });
const forumModule = sourceModule('src/lib/forum.ts');
const bodyModule = sourceModule('src/lib/request-body.ts');
const inboxModule = sourceModule('src/lib/inbox.ts');
// The corrections lookup needs a published story; the quota logic under test doesn't, so a fixed target stands in.
const correctionsModule = 'data:text/javascript,' + encodeURIComponent(`
  export const correctionKind = (value) => value === 'news' || value === 'event' ? value : null;
  export const correctionTarget = async (kind, slug) => ({ id: 'story-1', title: 'Fixture story', slug, path: '/news/' + slug });
  export const createCorrection = async () => 'correction-1';`);
const endpoint = (path, depth) => import(sourceModule(`src/pages/api/${path}.ts`, {
  [`${'../'.repeat(depth)}lib/request-body`]: bodyModule, [`${'../'.repeat(depth)}lib/forum`]: forumModule,
  [`${'../'.repeat(depth)}lib/quotas`]: quotasModule, [`${'../'.repeat(depth)}lib/inbox`]: inboxModule,
  [`${'../'.repeat(depth)}lib/corrections`]: correctionsModule,
}));
const inbox = await endpoint('inbox', 2);
const corrections = await endpoint('corrections', 2);
const threads = await endpoint('talk/threads', 3);
const replies = await endpoint('talk/replies', 3);
const reports = await endpoint('talk/reports', 3);
const votes = await endpoint('talk/votes', 3);
const { QUOTAS, normalizeIp, quotaClient } = await import(quotasModule);
const { RATE_LIMIT_RETENTION_MS, pruneAuthRateLimits } = await import(rateModule);

const origin = 'https://firelandscurrent.com';
let addresses = 0;
function freshIp() {
  assert.ok(++addresses < 255);
  return `203.0.113.${addresses}`;
}
function post(handler, path, fields, { user = null, ip = freshIp(), headers = {} } = {}) {
  const request = new Request(`${origin}${path}`, {
    method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': ip, ...headers }, body: new URLSearchParams(fields),
  });
  return handler.POST({ request, locals: { user } });
}
const all = (count, make) => Promise.all(Array.from({ length: count }, (_, index) => make(index)));
const tally = (responses, pick) => responses.reduce((counts, response) => {
  const key = pick(response);
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
const count = (sql, ...values) => database.prepare(sql).get(...values).count;

let users = 0;
function newUser() {
  const id = `user-${++users}`;
  database.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)')
    .run(id, `Reader ${users}`, `reader${users}@example.com`);
  return { id };
}
function newThread(authorId) {
  const id = crypto.randomUUID();
  database.prepare('INSERT INTO forum_threads (id, author_id, title, body, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, 0, 0, 0)')
    .run(id, authorId, 'Fixture discussion', 'Fixture body for the discussion.');
  return id;
}
function newReply(threadId, authorId) {
  const id = crypto.randomUUID();
  database.prepare('INSERT INTO forum_replies (id, thread_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)')
    .run(id, threadId, authorId, 'Fixture reply');
  return id;
}

const inboxFields = { kind: 'ads', name: 'Local Business', email: 'advertiser@example.com', subject: 'Autumn campaign',
  body: 'We would like to advertise our upcoming local event.', 'cf-turnstile-response': 'fixture-token' };
const correctionFields = { type: 'news', slug: 'fixture-story', name: 'Reader', email: 'reader@example.com',
  details: 'The council meeting was on Tuesday, not Monday.', 'cf-turnstile-response': 'fixture-token' };

test.beforeEach(() => { emails.length = 0; });
test.after(() => { globalThis.fetch = realFetch; delete globalThis.__quotaEnv; });

test('every counted window outlives its prune interval', () => {
  for (const quota of Object.values(QUOTAS)) assert.ok(quota.windowMs <= RATE_LIMIT_RETENTION_MS);
});

test('concurrent thread posts cannot exceed the hourly limit', async () => {
  const user = newUser();
  const responses = await all(QUOTAS.thread.max * 3, (index) =>
    post(threads, '/api/talk/threads', { title: `Concurrent discussion ${index}`, body: 'A discussion body long enough to pass validation.' }, { user }));
  assert.deepEqual(tally(responses, (r) => r.headers.get('Location').includes('error=rate') ? 'limited' : 'stored'),
    { stored: QUOTAS.thread.max, limited: QUOTAS.thread.max * 2 });
  assert.equal(count('SELECT COUNT(*) AS count FROM forum_threads WHERE author_id = ?', user.id), QUOTAS.thread.max);
  // Another reader's allowance is separate.
  const other = newUser();
  const response = await post(threads, '/api/talk/threads', { title: 'Another reader starts one', body: 'A discussion body long enough to pass validation.' }, { user: other });
  assert.match(response.headers.get('Location'), /\/talk\/[0-9a-f-]{36}$/);
});

test('rows older than the window do not count against a thread or reply author', async () => {
  const user = newUser();
  const thread = newThread(user.id);
  database.prepare('UPDATE forum_threads SET created_at = ? WHERE id = ?').run(Date.now() - QUOTAS.thread.windowMs - 1000, thread);
  for (let i = 0; i < QUOTAS.thread.max - 1; i++) newThread(user.id);
  database.prepare('UPDATE forum_threads SET created_at = ? WHERE author_id = ?').run(Date.now() - QUOTAS.thread.windowMs - 1000, user.id);
  const responses = await all(QUOTAS.thread.max + 2, (index) =>
    post(threads, '/api/talk/threads', { title: `Fresh discussion ${index}`, body: 'A discussion body long enough to pass validation.' }, { user }));
  assert.equal(responses.filter((r) => !r.headers.get('Location').includes('error=rate')).length, QUOTAS.thread.max);
});

test('concurrent replies cannot exceed the per-minute limit and only a stored reply bumps the thread', async () => {
  const user = newUser();
  const thread = newThread(newUser().id);
  const responses = await all(QUOTAS.reply.max * 4, (index) =>
    post(replies, '/api/talk/replies', { threadId: thread, body: `Concurrent comment ${index}` }, { user }));
  assert.deepEqual(tally(responses, (r) => r.headers.get('Location').includes('error=rate') ? 'limited' : 'stored'),
    { stored: QUOTAS.reply.max, limited: QUOTAS.reply.max * 3 });
  assert.equal(count('SELECT COUNT(*) AS count FROM forum_replies WHERE author_id = ?', user.id), QUOTAS.reply.max);
  assert.ok(database.prepare('SELECT last_activity_at FROM forum_threads WHERE id = ?').get(thread).last_activity_at > 0);

  const quiet = newThread(newUser().id);
  const quietUser = newUser();
  for (let i = 0; i < QUOTAS.reply.max; i++) newReply(quiet, quietUser.id);
  database.prepare('UPDATE forum_replies SET created_at = ? WHERE author_id = ?').run(Date.now(), quietUser.id);
  const refused = await post(replies, '/api/talk/replies', { threadId: quiet, body: 'One comment too many' }, { user: quietUser });
  assert.match(refused.headers.get('Location'), /error=rate/);
  assert.equal(database.prepare('SELECT last_activity_at FROM forum_threads WHERE id = ?').get(quiet).last_activity_at, 0, 'a refused reply must not bump the thread');
});

test('concurrent reports cannot exceed the hourly limit, and a repeat report is still not an error', async () => {
  const reporter = newUser();
  const author = newUser();
  const targets = Array.from({ length: QUOTAS.report.max + 5 }, () => newThread(author.id));
  const responses = await all(targets.length, (index) =>
    post(reports, '/api/talk/reports', { kind: 'thread', id: targets[index], reason: 'This discussion breaks the rules.' }, { user: reporter }));
  assert.deepEqual(tally(responses, (r) => r.status), { 303: QUOTAS.report.max, 429: 5 });
  assert.equal(count('SELECT COUNT(*) AS count FROM forum_reports WHERE reporter_id = ?', reporter.id), QUOTAS.report.max);

  const second = newUser();
  const once = { kind: 'thread', id: targets[0], reason: 'This discussion breaks the rules.' };
  assert.equal((await post(reports, '/api/talk/reports', once, { user: second })).status, 303);
  const repeat = await post(reports, '/api/talk/reports', once, { user: second });
  assert.equal(repeat.status, 303, 'an already-open report is quietly accepted, not rate limited');
  assert.equal(count('SELECT COUNT(*) AS count FROM forum_reports WHERE reporter_id = ?', second.id), 1);
});

test('votes are limited per signed-in reader per minute, even when requests arrive together', async () => {
  const voter = newUser();
  const thread = newThread(newUser().id);
  const responses = await all(QUOTAS.vote.max + 15, () => post(votes, '/api/talk/votes', { kind: 'thread', id: thread, vote: 'up' }, { user: voter }));
  assert.deepEqual(tally(responses, (r) => r.status), { 303: QUOTAS.vote.max, 429: 15 });
  const limited = responses.find((r) => r.status === 429);
  assert.match(limited.headers.get('Retry-After'), /^\d+$/);
  assert.ok(Number(limited.headers.get('Retry-After')) <= 60);
  // Moving to a new IP doesn't help a signed-in voter, and other readers are unaffected.
  assert.equal((await post(votes, '/api/talk/votes', { kind: 'thread', id: thread, vote: 'down' }, { user: voter })).status, 429);
  assert.equal((await post(votes, '/api/talk/votes', { kind: 'thread', id: thread, vote: 'up' }, { user: newUser(), ip: '203.0.113.250' })).status, 303);
});

test('invalid votes are rejected before they use any allowance', async () => {
  const voter = newUser();
  for (let i = 0; i < QUOTAS.vote.max + 5; i++) {
    assert.equal((await post(votes, '/api/talk/votes', { kind: 'thread', id: 'not-an-id', vote: 'up' }, { user: voter })).status, 400);
  }
  const thread = newThread(newUser().id);
  assert.equal((await post(votes, '/api/talk/votes', { kind: 'thread', id: thread, vote: 'up' }, { user: voter })).status, 303);
});

test('concurrent inbox submissions from one address stop at the limit and send nothing extra', async () => {
  const ip = freshIp();
  const responses = await all(QUOTAS.inbox.max + 4, () => post(inbox, '/api/inbox', inboxFields, { ip }));
  assert.deepEqual(tally(responses, (r) => r.status), { 303: QUOTAS.inbox.max, 429: 4 });
  assert.equal(emails.length, QUOTAS.inbox.max);
  const limited = responses.find((r) => r.status === 429);
  assert.match(limited.headers.get('Retry-After'), /^\d+$/);
  assert.equal(limited.headers.get('Cache-Control'), 'no-store');
  // The window doesn't extend while a client keeps retrying: ending it frees the address.
  database.prepare("UPDATE auth_rate_limits SET window_start = window_start - ? WHERE key LIKE 'quota:inbox:%'").run(QUOTAS.inbox.windowMs + 1000);
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip })).status, 303);
});

test('inbox allowances are per client: other addresses, signed-in readers, and IPv6 /64 networks', async () => {
  const ip = freshIp();
  await all(QUOTAS.inbox.max, () => post(inbox, '/api/inbox', inboxFields, { ip }));
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip })).status, 429);
  // A forged forwarding header changes nothing; only Cloudflare's connecting address counts.
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip, headers: { 'X-Forwarded-For': '198.51.100.7' } })).status, 429);
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip: freshIp() })).status, 303);
  // Signed-in readers count by account, so the shared address's exhausted allowance doesn't block them.
  const reader = newUser();
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip, user: reader })).status, 303);

  const prefix = '2001:db8:abcd:12';
  await all(QUOTAS.inbox.max, (index) => post(inbox, '/api/inbox', inboxFields, { ip: `${prefix}::${index + 1}` }));
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip: `${prefix}:ffff:1:2:3:4` })).status, 429);
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip: '2001:db8:abcd:13::1' })).status, 303);
});

test('contact, news tip, and advertising forms share one inbox allowance', async () => {
  const ip = freshIp();
  const kinds = ['contact', 'ads', 'news', 'contact', 'ads'];
  for (const kind of kinds) assert.equal((await post(inbox, '/api/inbox', { ...inboxFields, kind }, { ip })).status, 303);
  assert.equal((await post(inbox, '/api/inbox', { ...inboxFields, kind: 'news' }, { ip })).status, 429);
  assert.equal(count('SELECT COUNT(*) AS count FROM news_submissions'), 1, 'a limited tip is not stored');
});

test('submissions that would not be sent never use the allowance', async () => {
  const ip = freshIp();
  for (let i = 0; i < QUOTAS.inbox.max + 3; i++) {
    assert.match((await post(inbox, '/api/inbox', { ...inboxFields, website: 'spam' }, { ip })).headers.get('Location'), /sent=1$/);
    assert.match((await post(inbox, '/api/inbox', { ...inboxFields, email: 'bad' }, { ip })).headers.get('Location'), /error=invalid$/);
  }
  assert.equal(emails.length, 0);
  assert.equal((await post(inbox, '/api/inbox', inboxFields, { ip })).status, 303);
});

test('concurrent correction reports stop at their own limit, separate from the inbox allowance', async () => {
  const ip = freshIp();
  await all(QUOTAS.inbox.max, () => post(inbox, '/api/inbox', inboxFields, { ip }));
  const responses = await all(QUOTAS.corrections.max + 3, () => post(corrections, '/api/corrections', correctionFields, { ip }));
  assert.deepEqual(tally(responses, (r) => r.status), { 303: QUOTAS.corrections.max, 429: 3 });
  assert.equal(emails.filter((message) => message.subject.startsWith('Correction request')).length, QUOTAS.corrections.max);
});

test('counters hold a keyed hash of the address, never the address itself, and the prune removes them', async () => {
  const ip = '203.0.113.200';
  await post(inbox, '/api/inbox', inboxFields, { ip });
  const keys = database.prepare("SELECT key FROM auth_rate_limits WHERE key LIKE 'quota:%'").all().map((row) => row.key);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(!key.includes(ip) && !key.includes('203.0.113'), key);
  assert.match(keys.find((key) => key.startsWith('quota:inbox:')), /^quota:inbox:ip:[0-9a-f]{32}$/);
  assert.equal(await quotaClient(new Request(origin, { headers: { 'CF-Connecting-IP': ip } }), null),
    await quotaClient(new Request(origin, { headers: { 'CF-Connecting-IP': ' 203.0.113.200 ' } }), undefined));
  await pruneAuthRateLimits(db, Date.now() + RATE_LIMIT_RETENTION_MS + 1000);
  assert.equal(count("SELECT COUNT(*) AS count FROM auth_rate_limits WHERE key LIKE 'quota:%'"), 0);
});

test('normalizeIp groups IPv6 by /64 and leaves IPv4 alone', () => {
  assert.equal(normalizeIp('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('2001:DB8:abcd:12::1'), '2001:0db8:abcd:0012');
  assert.equal(normalizeIp('2001:db8:abcd:12:ffff:1:2:3'), '2001:0db8:abcd:0012');
  assert.equal(normalizeIp('::1'), '0000:0000:0000:0000');
  assert.equal(normalizeIp('2001:db8::'), '2001:0db8:0000:0000');
});

test('if the counter table is unavailable, a form submission is still accepted and the problem is logged', async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (message) => logged.push(message);
  database.exec('ALTER TABLE auth_rate_limits RENAME TO auth_rate_limits_hidden');
  try {
    assert.equal((await post(inbox, '/api/inbox', inboxFields)).status, 303);
  } finally {
    database.exec('ALTER TABLE auth_rate_limits_hidden RENAME TO auth_rate_limits');
    console.error = originalError;
  }
  assert.ok(logged.some((line) => line.includes('quota_unavailable')));
});
