import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// News tip retention (src/lib/tip-retention.ts) against the real migrations: declined tips deleted after 90
// days, reported tips anonymized after a year with their text kept, nothing else touched, and repeat runs
// changing nothing.
const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
let failNext = false;
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    let values = [];
    const query = {
      bind(...args) { values = args; return query; },
      async all() { return { results: statement.all(...values), meta: { changes: 0 } }; },
      async first() { return statement.get(...values) ?? null; },
      async run() {
        if (failNext && /news_submissions/.test(sql)) { failNext = false; throw new Error('Simulated D1 failure'); }
        return { meta: statement.run(...values) };
      },
    };
    return query;
  },
  // Statements run in order inside one transaction, as a D1 batch does.
  async batch(statements) {
    database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  },
};
globalThis.__tipTestEnv = { DB: db };
const stubEnv = 'data:text/javascript,export const env = globalThis.__tipTestEnv;';
function sourceModule(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? stubEnv : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const retention = await import(sourceModule('src/lib/tip-retention.ts'));
const { applyTipRetention, runTipRetention, deletedAccountTipStatements, tipRetentionDates,
  DECLINED_TIP_RETENTION_MS, TIP_CONTACT_RETENTION_MS, TIP_RETENTION_BATCH, TIP_RETENTION_INTERVAL_MS } = retention;
const auditUrl = sourceModule('src/lib/audit.ts');
const forumUrl = sourceModule('src/lib/forum.ts');
const { POST: reviewPost } = await import(sourceModule('src/pages/api/admin/submissions.ts', {
  '../../../lib/audit': auditUrl, '../../../lib/forum': forumUrl, '../../../lib/request-body': sourceModule('src/lib/request-body.ts'),
  '../../../lib/admin': sourceModule('src/lib/admin.ts'),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 8);
const quietly = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};

database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('reader', 'Reader Person', 'reader@example.test', '2026-01-01', '2026-01-01');
database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('editor', 'Editor Person', 'editor@example.test', '2026-01-01', '2026-01-01');
database.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?)').run('editor', 'editor', 1);

function story(id) {
  database.prepare(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, created_at, updated_at)
    VALUES (?, ?, 'A story from a tip', 'Summary', 'Story body', 'local', 'Sandusky', 'Staff', 'published', 1, 1)`).run(id, id);
}
function tip(id, { status = 'unread', decidedDaysAgo = null, createdDaysAgo = 400, user = null, article = null, anonymized = null } = {}) {
  database.prepare(`INSERT INTO news_submissions (id, submitter_user_id, name, email, subject, body, credit_requested, status, article_id,
      decided_at, anonymized_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
    .run(id, user, `Name ${id}`, `${id}@example.test`, `Subject ${id}`, `Tip text for ${id}`, status, article,
      decidedDaysAgo === null ? null : NOW - decidedDaysAgo * DAY, anonymized, NOW - createdDaysAgo * DAY, NOW - createdDaysAgo * DAY);
}
const tips = () => database.prepare('SELECT * FROM news_submissions ORDER BY id').all().map((row) => ({ ...row }));
const byId = () => Object.fromEntries(tips().map((row) => [row.id, row]));
const snapshot = (table) => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }));
const audit = () => snapshot('admin_audit_log');
const reset = () => {
  database.exec("DELETE FROM news_submissions; DELETE FROM admin_audit_log; DELETE FROM news_articles; UPDATE scheduled_jobs SET last_run_at = 0");
};
test.beforeEach(reset);
test.after(() => { database.close(); delete globalThis.__tipTestEnv; });

test('the migration starts existing decisions from updated_at and leaves unread tips without one', () => {
  const fresh = new DatabaseSync(':memory:');
  const files = readdirSync(new URL('../migrations/', import.meta.url)).sort();
  for (const name of files.filter((name) => name < '0028')) fresh.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  const insert = fresh.prepare(`INSERT INTO news_submissions (id, name, email, subject, body, status, created_at, updated_at) VALUES (?, 'N', 'n@example.test', 'S', 'B', ?, 1, ?)`);
  insert.run('a', 'unread', 5); insert.run('b', 'declined', 6); insert.run('c', 'reviewed', 7); insert.run('d', 'converted', 8);
  for (const name of files.filter((name) => name >= '0028')) fresh.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  assert.deepEqual(fresh.prepare('SELECT id, decided_at, anonymized_at FROM news_submissions ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 'a', decided_at: null, anonymized_at: null }, { id: 'b', decided_at: 6, anonymized_at: null },
    { id: 'c', decided_at: 7, anonymized_at: null }, { id: 'd', decided_at: 8, anonymized_at: null },
  ]);
  assert.deepEqual({ ...fresh.prepare("SELECT last_run_at FROM scheduled_jobs WHERE name = 'tip-retention'").get() }, { last_run_at: 0 });
  fresh.close();
});

test('declined tips are deleted 90 days after the decline, not 90 days after they arrived', async () => {
  tip('declined-old', { status: 'declined', decidedDaysAgo: 91 });
  tip('declined-edge', { status: 'declined', decidedDaysAgo: 90 });
  tip('declined-recent', { status: 'declined', decidedDaysAgo: 89, createdDaysAgo: 500 });
  const result = await applyTipRetention(db, NOW);
  assert.deepEqual({ deleted: result.deleted, anonymized: result.anonymized }, { deleted: 1, anonymized: 0 });
  assert.deepEqual(Object.keys(byId()), ['declined-edge', 'declined-recent']);
  // Exactly 90 days is kept until the next run; a millisecond later it is due.
  await applyTipRetention(db, NOW + 1);
  assert.deepEqual(Object.keys(byId()), ['declined-recent']);
});

test('reviewed and converted tips lose their submitter details after a year and keep their text', async () => {
  story('story-1');
  tip('reviewed-old', { status: 'reviewed', decidedDaysAgo: 366, user: 'reader' });
  tip('converted-old', { status: 'converted', decidedDaysAgo: 400, article: 'story-1', user: 'reader' });
  tip('converted-recent', { status: 'converted', decidedDaysAgo: 364, createdDaysAgo: 800, article: 'story-1' });
  const before = byId();
  const storyBefore = snapshot('news_articles');
  const result = await applyTipRetention(db, NOW);
  assert.equal(result.anonymized, 2);
  const after = byId();
  for (const id of ['reviewed-old', 'converted-old']) {
    assert.equal(after[id].name, '');
    assert.equal(after[id].email, '');
    assert.equal(after[id].submitter_user_id, null);
    assert.equal(after[id].anonymized_at, NOW);
    // The reporting record stays: subject, text, status, story link, credit choice and dates.
    for (const field of ['subject', 'body', 'status', 'article_id', 'credit_requested', 'created_at', 'decided_at']) assert.equal(after[id][field], before[id][field], `${id}.${field}`);
  }
  assert.deepEqual(after['converted-recent'], before['converted-recent']);
  assert.deepEqual(snapshot('news_articles'), storyBefore);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE id = 'reader'").get().n, 1);
});

test('unread tips are never removed for age, and other tables are untouched', async () => {
  story('story-2');
  tip('unread-ancient', { createdDaysAgo: 2000, user: 'reader' });
  tip('declined-old', { status: 'declined', decidedDaysAgo: 200 });
  tip('reviewed-old', { status: 'reviewed', decidedDaysAgo: 500 });
  // Earlier audit entries about these tips outlive them.
  database.prepare(`INSERT INTO admin_audit_log (id, actor_id, actor_name, target_type, target_id, target_label, action, detail, created_at)
    VALUES ('audit-1', 'editor', 'Editor Person', 'tip', 'declined-old', 'News tip declined-old', 'tip-declined', 'unread → declined', 1)`).run();
  const others = ['user', 'staff_roles', 'news_articles', 'forum_threads', 'corrections', 'media', 'session'].map(snapshot);
  const auditBefore = audit();
  const result = await quietly(() => applyTipRetention(db, NOW));
  assert.deepEqual(result, { deleted: 1, anonymized: 1, staleUnread: 1, more: false });
  assert.equal(byId()['unread-ancient'].name, 'Name unread-ancient');
  assert.equal(byId()['unread-ancient'].submitter_user_id, 'reader');
  assert.deepEqual(['user', 'staff_roles', 'news_articles', 'forum_threads', 'corrections', 'media', 'session'].map(snapshot), others);
  const entries = audit();
  assert.deepEqual(entries.slice(0, auditBefore.length), auditBefore);
  assert.equal(entries.length, auditBefore.length + 1);
});

test('the summary audit entry holds counts only, never tip contents or identifiers', async () => {
  tip('declined-a', { status: 'declined', decidedDaysAgo: 100 });
  tip('declined-b', { status: 'declined', decidedDaysAgo: 120 });
  tip('reviewed-a', { status: 'reviewed', decidedDaysAgo: 370, user: 'reader' });
  const contents = tips().flatMap((row) => [row.id, row.name, row.email, row.subject, row.body]).concat(['reader', 'Reader Person']);
  await applyTipRetention(db, NOW);
  const [entry] = audit();
  assert.deepEqual({ actor_id: entry.actor_id, actor_name: entry.actor_name, target_type: entry.target_type, target_id: entry.target_id,
    target_label: entry.target_label, action: entry.action, outcome: entry.outcome, created_at: entry.created_at }, {
    actor_id: null, actor_name: 'Scheduled retention', target_type: 'tip', target_id: null,
    target_label: 'News tips', action: 'tip-retention', outcome: 'success', created_at: NOW,
  });
  assert.equal(entry.detail, 'Deleted 2 declined tips past 90 days; Removed submitter details from 1 tip decided over a year ago');
  const text = JSON.stringify(entry);
  for (const value of contents) assert.ok(!text.includes(value), `audit entry mentions ${value}`);
});

test('running again changes nothing and adds no audit entry', async () => {
  story('story-3');
  tip('declined-old', { status: 'declined', decidedDaysAgo: 100 });
  tip('declined-new', { status: 'declined', decidedDaysAgo: 10 });
  tip('converted-old', { status: 'converted', decidedDaysAgo: 400, article: 'story-3' });
  tip('unread', { createdDaysAgo: 1 });
  await applyTipRetention(db, NOW);
  const [afterFirst, auditAfterFirst] = [tips(), audit()];
  const second = await applyTipRetention(db, NOW + 60 * 60 * 1000);
  assert.deepEqual({ deleted: second.deleted, anonymized: second.anonymized }, { deleted: 0, anonymized: 0 });
  assert.deepEqual(tips(), afterFirst);
  assert.deepEqual(audit(), auditAfterFirst);
  // An anonymized tip is not anonymized again, so its anonymized_at stays the first run's.
  assert.equal(byId()['converted-old'].anonymized_at, NOW);
});

test('each run touches a bounded batch, oldest first, and the scheduled job carries on until done', async () => {
  const total = TIP_RETENTION_BATCH + 25;
  for (let i = 0; i < total; i++) tip(`declined-${String(i).padStart(4, '0')}`, { status: 'declined', decidedDaysAgo: 100 + i });
  tip('declined-recent', { status: 'declined', decidedDaysAgo: 5 });
  const first = await quietly(() => runTipRetention(db, NOW));
  assert.deepEqual(first, { deleted: TIP_RETENTION_BATCH, anonymized: 0, staleUnread: 0, more: true });
  // The oldest decisions went first.
  assert.equal(byId()[`declined-${String(total - 1).padStart(4, '0')}`], undefined);
  assert.ok(byId()['declined-0000']);
  // A full batch hands the claim back, so the next five-minute run finishes the backlog.
  const second = await quietly(() => runTipRetention(db, NOW + 5 * 60 * 1000));
  assert.deepEqual(second, { deleted: 25, anonymized: 0, staleUnread: 0, more: false });
  assert.deepEqual(Object.keys(byId()), ['declined-recent']);
  assert.equal(await runTipRetention(db, NOW + 10 * 60 * 1000), null);
  assert.equal(audit().length, 2);
});

test('the scheduled job runs at most once a day however often the cron fires', async () => {
  tip('declined-a', { status: 'declined', decidedDaysAgo: 95 });
  assert.equal((await quietly(() => runTipRetention(db, NOW))).deleted, 1);
  tip('declined-b', { status: 'declined', decidedDaysAgo: 95 });
  for (let minutes = 5; minutes < 24 * 60; minutes += 5) assert.equal(await runTipRetention(db, NOW + minutes * 60 * 1000), null);
  assert.ok(byId()['declined-b']);
  assert.equal((await quietly(() => runTipRetention(db, NOW + TIP_RETENTION_INTERVAL_MS))).deleted, 1);
  assert.deepEqual(byId(), {});
});

test('a failed run hands its claim back so the next cron run retries', async () => {
  tip('declined-a', { status: 'declined', decidedDaysAgo: 95 });
  failNext = true;
  await assert.rejects(runTipRetention(db, NOW), /Simulated D1 failure/);
  assert.ok(byId()['declined-a']);
  assert.equal(audit().length, 0);
  assert.equal((await quietly(() => runTipRetention(db, NOW + 5 * 60 * 1000))).deleted, 1);
});

test('deleting an account deletes its unused tips and keeps reported ones unlinked', async () => {
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('leaving', 'Leaving Reader', 'leaving@example.test', '2026-01-01', '2026-01-01');
  story('story-4');
  tip('mine-unread', { user: 'leaving', createdDaysAgo: 1 });
  tip('mine-declined', { status: 'declined', decidedDaysAgo: 1, user: 'leaving' });
  tip('mine-reviewed', { status: 'reviewed', decidedDaysAgo: 1, user: 'leaving' });
  tip('mine-converted', { status: 'converted', decidedDaysAgo: 1, user: 'leaving', article: 'story-4' });
  tip('someone-unread', { user: 'reader' });
  tip('guest-unread');
  await db.batch([...deletedAccountTipStatements(db, 'leaving'), db.prepare('DELETE FROM user WHERE id = ?').bind('leaving')]);
  const after = byId();
  assert.deepEqual(Object.keys(after), ['guest-unread', 'mine-converted', 'mine-reviewed', 'someone-unread']);
  for (const id of ['mine-converted', 'mine-reviewed']) {
    assert.equal(after[id].submitter_user_id, null);
    assert.equal(after[id].body, `Tip text for ${id}`);
  }
  assert.equal(after['mine-converted'].article_id, 'story-4');
  assert.equal(after['someone-unread'].submitter_user_id, 'reader');
  // They lose their name and email on the usual schedule.
  await applyTipRetention(db, NOW + TIP_CONTACT_RETENTION_MS);
  assert.equal(byId()['mine-reviewed'].email, '');
});

test('declining and converting start the retention clock; the inbox shows the dates', async () => {
  tip('t-review-1234', { createdDaysAgo: 10 });
  const call = (fields, staffRole = 'editor') => reviewPost({
    request: new Request('https://firelandscurrent.com/api/admin/submissions', { method: 'POST', headers: { origin: 'https://firelandscurrent.com' }, body: new URLSearchParams(fields) }),
    locals: { user: { id: 'editor', name: 'Editor Person' }, staffRole },
  });
  const started = Date.now();
  assert.equal((await call({ id: 't-review-1234', status: 'reviewed' })).status, 303);
  const reviewed = byId()['t-review-1234'];
  assert.ok(reviewed.decided_at >= started);
  assert.equal(tipRetentionDates(reviewed).anonymizesAt, reviewed.decided_at + TIP_CONTACT_RETENTION_MS);
  assert.equal((await call({ id: 't-review-1234', status: 'declined' })).status, 303);
  const declined = byId()['t-review-1234'];
  assert.ok(declined.decided_at >= reviewed.decided_at);
  assert.deepEqual(tipRetentionDates(declined), { deletesAt: declined.decided_at + DECLINED_TIP_RETENTION_MS, anonymizesAt: null });
  assert.deepEqual(tipRetentionDates({ status: 'unread', decided_at: null, anonymized_at: null }), { deletesAt: null, anonymizesAt: null });
  const page = readFileSync(new URL('../src/pages/admin/news/new.astro', import.meta.url), 'utf8');
  assert.match(page, /SET status = 'converted', article_id = \?1, updated_at = \?2, decided_at = \?2/);
});

test('an editor can remove submitter details early; it is audited once and keeps the text', async () => {
  tip('t-anon-12345', { status: 'converted', decidedDaysAgo: 3, user: 'reader' });
  const call = (staffRole = 'editor', origin = 'https://firelandscurrent.com') => reviewPost({
    request: new Request('https://firelandscurrent.com/api/admin/submissions', { method: 'POST', headers: { origin }, body: new URLSearchParams({ id: 't-anon-12345', action: 'anonymize' }) }),
    locals: { user: { id: 'editor', name: 'Editor Person' }, staffRole },
  });
  assert.equal((await call('moderator')).status, 403);
  assert.equal((await call('editor', 'https://attacker.invalid')).status, 403);
  assert.equal(byId()['t-anon-12345'].email, 't-anon-12345@example.test');
  assert.equal((await call()).status, 303);
  assert.equal((await call()).status, 303);
  const row = byId()['t-anon-12345'];
  assert.deepEqual([row.name, row.email, row.submitter_user_id, row.body, row.status], ['', '', null, 'Tip text for t-anon-12345', 'converted']);
  const entries = audit().filter((entry) => entry.action === 'tip-anonymized');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target_id, 't-anon-12345');
  assert.equal(entries[0].detail, null);
  // Already anonymized, so the scheduled run leaves it alone.
  assert.equal((await applyTipRetention(db, NOW + 2 * TIP_CONTACT_RETENTION_MS)).anonymized, 0);
});
