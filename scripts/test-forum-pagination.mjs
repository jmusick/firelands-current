import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE forum_replies (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, author_id TEXT NOT NULL, parent_id TEXT,
    body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE forum_reply_votes (user_id TEXT NOT NULL, reply_id TEXT NOT NULL, value INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (reply_id, user_id));
  CREATE TABLE forum_threads (
    id TEXT PRIMARY KEY, author_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published',
    article_id TEXT, event_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL
  );
  CREATE TABLE forum_thread_votes (user_id TEXT NOT NULL, thread_id TEXT NOT NULL, value INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (thread_id, user_id));
  CREATE TABLE news_articles (id TEXT PRIMARY KEY, slug TEXT NOT NULL, headline TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL);
  CREATE TABLE events (id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL);
  INSERT INTO "user" VALUES ('u1', 'Reader');
`);
globalThis.__paginationEnv = { DB: { prepare(sql) {
  const statement = database.prepare(sql);
  let values = [];
  const query = {
    bind(...args) { values = args; return query; },
    async all() { return { results: statement.all(...values) }; },
    async first() { return statement.get(...values) ?? null; },
  };
  return query;
} } };
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__paginationEnv;')}`;
const sources = {};
async function load(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_m, s) => `from ${JSON.stringify(s === 'cloudflare:workers' ? envModule : replacements[s] ?? import.meta.resolve(s))}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  sources[path] = url;
  return import(url);
}
const { listComments, listThreads, COMMENTS_PER_PAGE } = await load('src/lib/forum.ts');
const { parseMediaPage } = await load('src/lib/media.ts', { './forum': sources['src/lib/forum.ts'] });

const insert = database.prepare(`INSERT INTO forum_replies (id, thread_id, author_id, parent_id, body, status, created_at, updated_at) VALUES (?, ?, 'u1', ?, ?, ?, ?, ?)`);
function add(id, thread, parent, createdAt, status = 'published') { insert.run(id, thread, parent, `body ${id}`, status, createdAt, createdAt); }

test('media page inputs must be plain whole numbers in range', () => {
  assert.equal(parseMediaPage(null), 0);
  assert.equal(parseMediaPage(''), 0);
  assert.equal(parseMediaPage('3'), 3);
  assert.equal(parseMediaPage('1000'), 1000);
  for (const bad of ['1.5', '-1', '1001', '1e3', 'abc', '99999999999999999999', ' 2', '0x10', 'NaN', 'Infinity']) {
    assert.equal(parseMediaPage(bad), null, bad);
  }
});

test('discussions over 5,000 comments keep the newest comment and order deterministically', async () => {
  database.exec('BEGIN');
  for (let i = 0; i < 5600; i++) add(`big-${String(i).padStart(5, '0')}`, 'big', null, 1000 + Math.floor(i / 2));
  database.exec('COMMIT');
  const newest = await listComments('big', 0, 'new');
  assert.equal(newest.rootCount, 5600);
  assert.equal(newest.comments.length, COMMENTS_PER_PAGE);
  assert.equal(newest.comments[0].id, 'big-05599', 'newest comment must lead the newest-first page');
  const oldest = await listComments('big', Math.floor(5599 / COMMENTS_PER_PAGE), 'old');
  assert.equal(oldest.comments.at(-1).id, 'big-05599', 'newest comment must be on the last oldest-first page');
  // Equal timestamps tie-break on id, and repeated loads give the same page.
  assert.deepEqual((await listComments('big', 3, 'old')).comments.map((c) => c.id), (await listComments('big', 3, 'old')).comments.map((c) => c.id));
  assert.ok(newest.comments[0].created_at === newest.comments[1].created_at && newest.comments[0].id > newest.comments[1].id);
});

test('replies stay under their parent and hidden parents survive only for visible replies', async () => {
  add('a', 't', null, 10);
  add('a1', 't', 'a', 11);
  add('a1x', 't', 'a1', 12);
  add('h', 't', null, 13, 'hidden');
  add('h1', 't', 'h', 14);
  add('gone', 't', null, 15, 'hidden');
  add('gone1', 't', 'gone', 16, 'hidden');
  const { comments, rootCount } = await listComments('t', 0, 'old');
  assert.equal(rootCount, 2);
  assert.deepEqual(comments.map((c) => [c.id, c.depth, c.removed]), [['a', 0, false], ['a1', 1, false], ['a1x', 2, false], ['h', 0, true], ['h1', 1, false]]);
});

test('malformed page values fall back to the first page', async () => {
  for (const page of [-1, 1.5, NaN, Infinity]) {
    assert.equal((await listComments('t', page, 'old')).comments[0].id, 'a');
  }
  assert.deepEqual((await listComments('t', 99, 'old')).comments, []);
});

test('the unfiltered list skips unreplied story and event threads; kind tabs keep them', async () => {
  const addThread = database.prepare(`INSERT INTO forum_threads (id, author_id, title, body, article_id, event_id, created_at, updated_at, last_activity_at) VALUES (?, 'u1', ?, 'body', ?, ?, ?, ?, ?)`);
  const article = (n) => database.prepare(`INSERT INTO news_articles VALUES (?, ?, ?, 'summary', 'published')`).run(`a${n}`, `story-${n}`, `Story ${n}`);
  const event = (n) => database.prepare(`INSERT INTO events VALUES (?, ?, ?, 'summary', 'published')`).run(`e${n}`, `event-${n}`, `Event ${n}`);
  const reply = (thread, n, status = 'published') => add(`tr-${thread}-${n}`, thread, null, 5, status);

  // Quiet automatic threads are the newest, so they would lead the old list.
  article(1); addThread.run('story-quiet', 's1', 'a1', null, 900, 900, 900);
  article(2); addThread.run('story-hidden-reply', 's2', 'a2', null, 899, 899, 899); reply('story-hidden-reply', 1, 'hidden');
  article(3); addThread.run('story-talked', 's3', 'a3', null, 100, 100, 100); reply('story-talked', 1);
  event(1); addThread.run('event-quiet', 'e1', null, 'e1', 898, 898, 898);
  event(2); addThread.run('event-talked', 'e2', null, 'e2', 101, 101, 101); reply('event-talked', 1);
  addThread.run('community-quiet', 'c0', null, null, 897, 897, 897);

  const ids = async (page, kind) => (await listThreads(page, '', kind)).map((t) => t.id);
  const all = await ids(0, null);
  assert.deepEqual(all, ['community-quiet', 'event-talked', 'story-talked']);
  assert.deepEqual(await ids(0, 'story'), ['story-quiet', 'story-hidden-reply', 'story-talked']);
  assert.deepEqual(await ids(0, 'event'), ['event-quiet', 'event-talked']);
  assert.deepEqual(await ids(0, 'community'), ['community-quiet']);
  assert.equal((await listThreads(0, '', null)).find((t) => t.id === 'story-talked').reply_count, 1);

  // Paging across the boundary: many equal timestamps must neither drop nor repeat a thread.
  database.exec('BEGIN');
  for (let i = 0; i < 45; i++) {
    const id = `page-${String(i).padStart(2, '0')}`;
    if (i % 3 === 0) { article(`p${i}`); addThread.run(id, 'x', `ap${i}`, null, 500, 500, 500); reply(id, 1); }
    else if (i % 3 === 1) addThread.run(id, 'x', null, null, 500, 500, 500);
    else { article(`q${i}`); addThread.run(id, 'x', `aq${i}`, null, 500, 500, 500); } // unreplied, must not appear
  }
  database.exec('COMMIT');
  const pages = [];
  for (let page = 0; page < 5; page++) {
    const rows = await ids(page, null);
    pages.push(rows.slice(0, 20));
    if (rows.length <= 20) break;
  }
  const seen = pages.flat();
  assert.equal(new Set(seen).size, seen.length, 'no thread repeats across pages');
  const expected = ['community-quiet', 'event-talked', 'story-talked'].concat(
    Array.from({ length: 45 }, (_, i) => `page-${String(i).padStart(2, '0')}`).filter((_, i) => i % 3 !== 2));
  assert.deepEqual([...seen].sort(), [...expected].sort(), 'no thread is dropped or leaked');
  assert.ok(pages.slice(0, -1).every((rows) => rows.length === 20), 'pages stay full');
});
