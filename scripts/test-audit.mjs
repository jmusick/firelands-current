import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Newsroom and moderation audit entries, and the denied-attempt records, against the real migrations.
const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    let values = [];
    const query = {
      bind(...args) { values = args; return query; },
      async all() { return { results: statement.all(...values) }; },
      async first() { return statement.get(...values) ?? null; },
      async run() { return { meta: statement.run(...values) }; },
    };
    return query;
  },
  // Statements run in order, as a D1 batch does.
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
};
globalThis.__auditTestEnv = { DB: db };
const stubEnv = 'data:text/javascript,export const env = globalThis.__auditTestEnv;';
const modules = new Map();
function sourceModule(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? stubEnv : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const auditUrl = sourceModule('src/lib/audit.ts');
const forumUrl = sourceModule('src/lib/forum.ts');
const bodyUrl = sourceModule('src/lib/request-body.ts');
const adminUrl = sourceModule('src/lib/admin.ts');
const { recordDenied, denyAdmin, auditRecord, DENIED_THROTTLE_MS } = await import(auditUrl);
const correctionsUrl = sourceModule('src/lib/corrections.ts');
const usersUrl = sourceModule('src/lib/users.ts', {
  './auth': 'data:text/javascript,export const createAuth = () => { throw new Error("not used"); };',
  './forum': forumUrl, './password-hash': sourceModule('src/lib/password-hash.ts'), './password-policy': 'data:text/javascript,export const MAX_PASSWORD = 128, MIN_PASSWORD = 12;',
});
const { listAudit, AUDIT_LABELS } = await import(usersUrl);
const endpoint = (path, name) => import(sourceModule(path, {
  [`${name}/audit`]: auditUrl, [`${name}/forum`]: forumUrl, [`${name}/request-body`]: bodyUrl, [`${name}/admin`]: adminUrl, [`${name}/corrections`]: correctionsUrl,
}));
const { POST: deleteStory } = await endpoint('src/pages/api/admin/news/delete.ts', '../../../../lib');
const { POST: eventsApi } = await endpoint('src/pages/api/admin/events.ts', '../../../lib');
const { POST: talkApi } = await endpoint('src/pages/api/admin/talk.ts', '../../../lib');
const { POST: correctionsApi } = await endpoint('src/pages/api/admin/corrections.ts', '../../../lib');

const now = Date.now();
const account = (id, name) => database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
  .run(id, name, `${id}@example.test`, '2026-10-01', '2026-10-01');
account('admin', 'Admin Person'); account('editor', 'Editor Person'); account('moderator', 'Moderator Person'); account('reader', 'Reader Person');
const people = {
  admin: { user: { id: 'admin', name: 'Admin Person' }, staffRole: 'admin' },
  editor: { user: { id: 'editor', name: 'Editor Person' }, staffRole: 'editor' },
  moderator: { user: { id: 'moderator', name: 'Moderator Person' }, staffRole: 'moderator' },
  reader: { user: { id: 'reader', name: 'Reader Person' }, staffRole: null },
  anonymous: { user: null, staffRole: null },
};
const rows = (where = '1 = 1') => database.prepare(`SELECT actor_id, actor_name, target_type, target_id, target_label, action, detail, outcome FROM admin_audit_log WHERE ${where} ORDER BY rowid`).all().map((row) => ({ ...row }));
const post = (api, path, who, fields, origin = 'https://firelandscurrent.com') => api({
  request: new Request(`https://firelandscurrent.com${path}`, { method: 'POST', headers: origin ? { origin } : {}, body: new URLSearchParams(fields) }),
  locals: people[who],
});
const clear = () => database.exec('DELETE FROM admin_audit_log');
const ID = '11111111-1111-4111-8111-111111111111';

test.after(() => { database.close(); delete globalThis.__auditTestEnv; });

test('deleting a story or event is attributed, labelled before the record goes, and missing records add nothing', async () => {
  clear();
  database.exec(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, published_at, created_at, updated_at)
    VALUES ('story-0001', 'doomed', 'A headline that will be deleted', 'Summary text', 'SECRET story text', 'local', 'Sandusky', 'Reporter', 'published', 1, 1, 1)`);
  database.exec(`INSERT INTO events (id, slug, title, summary, category, starts_on, venue, community, status, created_at, updated_at)
    VALUES ('event-0001', 'doomed-event', 'An event that will be deleted', 'Summary text', 'community', '2026-10-10', 'Park', 'Sandusky', 'published', 1, 1)`);
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'admin', { id: 'story-0001' })).status, 303);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM news_articles WHERE id = 'story-0001'").get().n, 0);
  assert.deepEqual(rows(), [{ actor_id: 'admin', actor_name: 'Admin Person', target_type: 'story', target_id: 'story-0001',
    target_label: 'A headline that will be deleted', action: 'story-delete', detail: null, outcome: 'success' }]);
  // Deleting it again, or an id that never existed, changes nothing and records nothing.
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'admin', { id: 'story-0001' })).status, 303);
  assert.equal(rows().length, 1);

  assert.equal((await post(eventsApi, '/api/admin/events', 'admin', { action: 'delete', id: 'event-0001' })).status, 303);
  assert.equal((await post(eventsApi, '/api/admin/events', 'admin', { action: 'delete', id: 'event-0001' })).status, 404);
  assert.deepEqual(rows("target_type = 'event'"), [{ actor_id: 'admin', actor_name: 'Admin Person', target_type: 'event', target_id: 'event-0001',
    target_label: 'An event that will be deleted', action: 'event-delete', detail: null, outcome: 'success' }]);
  assert.doesNotMatch(JSON.stringify(rows()), /SECRET/);
});

test('refused delete attempts by signed-in accounts are recorded as denied, once per actor and action per window', async () => {
  clear();
  database.exec(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, created_at, updated_at)
    VALUES ('story-0002', 'kept', 'A headline that stays', 'Summary text', 'Story text', 'local', 'Sandusky', 'Reporter', 'draft', 1, 1)`);
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'editor', { id: 'story-0002' })).status, 403);
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'editor', { id: 'story-0002' })).status, 403);
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'reader', { id: 'story-0002' })).status, 403);
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'admin', { id: 'story-0002' }, 'https://attacker.invalid')).status, 403);
  // The same actor and action again, from another origin: still inside the window.
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'admin', { id: 'story-0002' }, null)).status, 403);
  assert.equal((await post(deleteStory, '/api/admin/news/delete', 'anonymous', { id: 'story-0002' })).status, 303);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM news_articles WHERE id = 'story-0002'").get().n, 1);
  assert.deepEqual(rows(), [
    { actor_id: 'editor', actor_name: 'Editor Person', target_type: null, target_id: null, target_label: '/api/admin/news/delete', action: 'story-delete',
      detail: 'Needs a staff role this account lacks (account role: editor)', outcome: 'denied' },
    { actor_id: 'reader', actor_name: 'Reader Person', target_type: null, target_id: null, target_label: '/api/admin/news/delete', action: 'story-delete',
      detail: 'Needs a staff role this account lacks (account role: none)', outcome: 'denied' },
    { actor_id: 'admin', actor_name: 'Admin Person', target_type: null, target_id: null, target_label: '/api/admin/news/delete', action: 'story-delete',
      detail: 'Cross-origin request refused', outcome: 'denied' },
  ]);
});

test('the denied throttle lapses, ignores other actions, and a write failure never changes the 403', async () => {
  clear();
  const request = new Request('https://firelandscurrent.com/api/admin/talk', { method: 'POST' });
  await recordDenied(people.editor.user, request, 'talk-moderate', 'role', 'editor');
  await recordDenied(people.editor.user, request, 'talk-moderate', 'role', 'editor');
  await recordDenied(people.editor.user, request, 'event-delete', 'role', 'editor');
  assert.deepEqual(rows().map((row) => row.action), ['talk-moderate', 'event-delete']);
  database.prepare('UPDATE admin_audit_log SET created_at = ? WHERE action = ?').run(Date.now() - DENIED_THROTTLE_MS - 1, 'talk-moderate');
  await recordDenied(people.editor.user, request, 'talk-moderate', 'role', 'editor');
  assert.equal(rows("action = 'talk-moderate'").length, 2);

  const original = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  const realDb = globalThis.__auditTestEnv.DB;
  globalThis.__auditTestEnv.DB = { prepare() { throw new Error('database unavailable'); } };
  try {
    const response = await denyAdmin(people.editor, request, 'talk-moderate', 'role');
    assert.equal(response.status, 403);
    assert.equal(await response.text(), 'Forbidden');
  } finally { globalThis.__auditTestEnv.DB = realDb; console.error = original; }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ event: 'audit_denied_write_failed', action: 'talk-moderate' }]);
});

test('moderation actions are audited with titles and ids, never post text or who wrote or reported it', async () => {
  clear();
  const thread = '22222222-2222-4222-8222-222222222222';
  const reply = '33333333-3333-4333-8333-333333333333';
  const report = '44444444-4444-4444-8444-444444444444';
  const second = '55555555-5555-4555-8555-555555555555';
  database.exec(`INSERT INTO forum_threads (id, author_id, title, body, status, created_at, updated_at, last_activity_at)
    VALUES ('${thread}', 'reader', 'A lively discussion', 'SECRET thread body', 'published', 1, 1, 1)`);
  database.exec(`INSERT INTO forum_replies (id, thread_id, author_id, body, status, created_at, updated_at)
    VALUES ('${reply}', '${thread}', 'reader', 'SECRET reply body', 'published', 1, 1)`);
  const columns = database.prepare('PRAGMA table_info(forum_reports)').all().map((column) => column.name);
  assert.ok(columns.includes('thread_id') && columns.includes('reply_id'));
  const addReport = (id, target) => database.prepare(`INSERT INTO forum_reports (id, ${target.column}, reporter_id, reason, status, created_at) VALUES (?, ?, 'moderator', 'SECRET reporter note', 'open', 1)`).run(id, target.id);

  assert.equal((await post(talkApi, '/api/admin/talk', 'moderator', { action: 'hide-thread', threadId: thread })).status, 303);
  assert.equal((await post(talkApi, '/api/admin/talk', 'moderator', { action: 'restore-thread', threadId: thread })).status, 303);
  addReport(report, { column: 'reply_id', id: reply });
  assert.equal((await post(talkApi, '/api/admin/talk', 'admin', { action: 'hide-reported', reportId: report })).status, 303);
  assert.equal(database.prepare('SELECT status FROM forum_replies WHERE id = ?').get(reply).status, 'hidden');
  assert.equal(database.prepare('SELECT status FROM forum_reports WHERE id = ?').get(report).status, 'resolved');
  addReport(second, { column: 'thread_id', id: thread });
  assert.equal((await post(talkApi, '/api/admin/talk', 'moderator', { action: 'dismiss', reportId: second })).status, 303);
  // Resolved or unknown reports and bad ids change and record nothing.
  assert.equal((await post(talkApi, '/api/admin/talk', 'moderator', { action: 'dismiss', reportId: second })).status, 404);
  assert.equal((await post(talkApi, '/api/admin/talk', 'moderator', { action: 'hide-thread', threadId: 'nope nope' })).status, 400);

  assert.deepEqual(rows().map((row) => [row.actor_id, row.action, row.target_type, row.target_id, row.target_label, row.detail]), [
    ['moderator', 'thread-hide', 'thread', thread, 'A lively discussion', null],
    ['moderator', 'thread-restore', 'thread', thread, 'A lively discussion', null],
    ['admin', 'reply-hide', 'reply', reply, 'Reply in A lively discussion', `Report ${report}, hidden from a report`],
    ['moderator', 'report-dismiss', 'thread', thread, 'A lively discussion', `Report ${second}`],
  ]);
  assert.doesNotMatch(JSON.stringify(rows()), /SECRET|Reader Person|reader@/);

  // An editor has no Talk role: refused, recorded, and nothing hidden.
  clear();
  assert.equal((await post(talkApi, '/api/admin/talk', 'editor', { action: 'hide-thread', threadId: thread })).status, 403);
  assert.equal(database.prepare('SELECT status FROM forum_threads WHERE id = ?').get(thread).status, 'published');
  assert.deepEqual(rows().map((row) => [row.action, row.outcome]), [['talk-moderate', 'denied']]);
});

test('correction decisions are audited with the status change and no reader details', async () => {
  clear();
  database.exec(`INSERT INTO corrections (id, kind, item_title, item_slug, name, email, details, suggested_fix, source_url, status, created_at, updated_at)
    VALUES ('correction-1', 'news', 'Council story', 'council-story', 'SECRET Reader', 'secret-reader@example.test', 'SECRET details', '', '', 'open', 1, 1)`);
  assert.equal((await post(correctionsApi, '/api/admin/corrections', 'editor', { id: 'correction-1', action: 'corrected', note: 'SECRET staff note' })).status, 303);
  assert.equal((await post(correctionsApi, '/api/admin/corrections', 'editor', { id: 'correction-1', action: 'reopen' })).status, 303);
  assert.equal((await post(correctionsApi, '/api/admin/corrections', 'admin', { id: 'correction-1', action: 'declined', note: 'Not an error' })).status, 303);
  assert.equal((await post(correctionsApi, '/api/admin/corrections', 'editor', { id: 'missing-one', action: 'declined' })).status, 404);
  assert.deepEqual(rows().map((row) => [row.actor_id, row.action, row.target_type, row.target_id, row.target_label, row.detail]), [
    ['editor', 'correction-corrected', 'correction', 'correction-1', 'Council story', 'news: open → corrected'],
    ['editor', 'correction-reopen', 'correction', 'correction-1', 'Council story', 'news: corrected → open'],
    ['admin', 'correction-declined', 'correction', 'correction-1', 'Council story', 'news: open → declined'],
  ]);
  assert.doesNotMatch(JSON.stringify(rows()), /SECRET|secret-reader/);
  assert.equal(database.prepare("SELECT resolved_by FROM corrections WHERE id = 'correction-1'").get().resolved_by, 'admin');
  assert.equal((await post(correctionsApi, '/api/admin/corrections', 'moderator', { id: 'correction-1', action: 'corrected' })).status, 403);
  assert.equal(rows("outcome = 'denied'").length, 1);
});

test('the audit view reads the new entries: labels exist for every action and live records link back', async () => {
  clear();
  database.exec(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, created_at, updated_at)
    VALUES ('story-0003', 'linked', 'A linked headline', 'Summary text', 'Story text', 'local', 'Sandusky', 'Reporter', 'draft', 1, 1)`);
  database.exec(`INSERT INTO news_submissions (id, name, email, subject, body, status, created_at, updated_at)
    VALUES ('tip-12345678', 'Tipster', 'tipster@example.test', 'A subject', 'A tip body', 'unread', 1, 1)`);
  const actor = people.admin.user;
  await db.batch([
    auditRecord(actor, 'story', 'story-0003', 'story-publish'),
    auditRecord(actor, 'tip', 'tip-12345678', 'tip-reviewed', 'unread → reviewed', { sql: "status IN ('unread')", binds: [] }),
    auditRecord(actor, 'story', 'story-gone', 'story-delete'),
  ]);
  await recordDenied(people.editor.user, new Request('https://firelandscurrent.com/api/admin/events', { method: 'POST' }), 'event-delete', 'role', 'editor');
  const entries = await listAudit(10);
  const byAction = Object.fromEntries(entries.map((entry) => [entry.action, entry]));
  assert.equal(byAction['story-publish'].resource_href, '/admin/news/story-0003');
  assert.equal(byAction['tip-reviewed'].resource_href, '/admin/submissions/tip-12345678');
  assert.equal(byAction['tip-reviewed'].target_label, 'News tip tip-12345678');
  assert.equal(byAction['event-delete'].outcome, 'denied');
  assert.equal(byAction['event-delete'].resource_href, null);
  assert.equal(entries.length, 3);
  for (const action of ['story-create', 'story-update', 'story-publish', 'story-unpublish', 'story-feature', 'story-unfeature', 'story-delete', 'story-save',
    'event-create', 'event-update', 'event-publish', 'event-unpublish', 'event-cancel', 'event-delete', 'event-save', 'thread-hide', 'thread-restore',
    'reply-hide', 'report-dismiss', 'talk-moderate', 'correction-corrected', 'correction-declined', 'correction-reopen', 'correction-resolve',
    'tip-reviewed', 'tip-declined', 'tip-converted', 'tip-review', 'user-admin', 'business-admin', 'ad-admin', 'media-admin', 'facebook-resolve']) {
    assert.ok(AUDIT_LABELS[action], `${action} needs a label`);
  }
});
