import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE forum_replies (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published');
  CREATE TABLE forum_thread_votes (user_id TEXT NOT NULL, thread_id TEXT NOT NULL, value INTEGER NOT NULL);
  CREATE TABLE forum_threads (
    id TEXT PRIMARY KEY, author_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published',
    article_id TEXT, event_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL
  );
  CREATE TABLE news_articles (id TEXT PRIMARY KEY, slug TEXT NOT NULL, headline TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL);
  CREATE TABLE events (id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, starts_on TEXT, ends_on TEXT);
  INSERT INTO "user" VALUES ('newsroom', 'Newsroom');
`);
globalThis.__threadDateEnv = { DB: { prepare(sql) {
  const statement = database.prepare(sql);
  let values = [];
  const query = {
    bind(...args) { values = args; return query; },
    async all() { return { results: statement.all(...values) }; },
    async first() { return statement.get(...values) ?? null; },
  };
  return query;
} } };
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__threadDateEnv;')}`;
const urls = {};
async function load(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_m, s) => `from ${JSON.stringify(s === 'cloudflare:workers' ? envModule : replacements[s] ?? import.meta.resolve(s))}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls[path] = url;
  return import(url);
}
const forum = await load('src/lib/forum.ts');
await load('src/lib/events.ts', {
  './news': 'data:text/javascript,export const LEAD_COLUMNS = "";',
  './ad-tracking': 'data:text/javascript,export const statDay = () => "2026-10-03";',
});
const { eventWhen, threadHeading, threadDescription } = await load('src/lib/thread-display.ts', { './events': urls['src/lib/events.ts'], './forum': urls['src/lib/forum.ts'] });

// Every discussion was created on Sept. 1, weeks before any occurrence.
const created = Date.UTC(2026, 8, 1, 15);
const addEvent = (id, slug, startsOn, endsOn, title = 'Historic jail and dungeon flashlight tour') => {
  database.prepare(`INSERT INTO events VALUES (?, ?, ?, 'Walk the old jail by flashlight.', 'published', ?, ?)`).run(id, slug, title, startsOn, endsOn);
  database.prepare(`INSERT INTO forum_threads VALUES (?, 'newsroom', 'x', 'x', 'published', NULL, ?, ?, ?, ?)`).run(`t-${id}`, id, created, created, created);
};
addEvent('e1', 'fremont-jail-flashlight-tour-october-14-2026', '2026-10-14', null);
addEvent('e2', 'fremont-jail-flashlight-tour-october-28-2026', '2026-10-28', null);
addEvent('e3', 'fall-fest', '2026-10-30', '2026-11-02', 'Fall fest');
addEvent('e4', 'fall-fest-weekend', '2026-10-03', '2026-10-05', 'Fall weekend');
addEvent('e5', 'new-year', '2027-01-01', null, 'First day hike');
database.prepare(`INSERT INTO news_articles VALUES ('a1', 'a-story', 'A story', 'Story summary', 'published')`).run();
database.prepare(`INSERT INTO forum_threads VALUES ('t-a1', 'newsroom', 'x', 'x', 'published', 'a1', NULL, ?, ?, ?)`).run(created, created, created);
database.prepare(`INSERT INTO forum_threads VALUES ('t-c', 'newsroom', 'Reader topic', 'Reader body', 'published', NULL, NULL, ?, ?, ?)`).run(created, created, created);

test('two occurrences of one event get distinct headings and descriptions naming their own dates', async () => {
  const [a, b] = [await forum.getThread('t-e1'), await forum.getThread('t-e2')];
  assert.equal(a.title, b.title);
  assert.equal(threadHeading(a), 'Historic jail and dungeon flashlight tour on Wednesday, October 14, 2026');
  assert.equal(threadHeading(b), 'Historic jail and dungeon flashlight tour on Wednesday, October 28, 2026');
  assert.notEqual(threadDescription(a), threadDescription(b));
  assert.match(threadDescription(a), /^Event is on Wednesday, October 14, 2026\. Walk the old jail/);
});

test('the date comes from the event, not from when the discussion was created', async () => {
  const thread = await forum.getThread('t-e1');
  assert.equal(thread.created_at, created);
  assert.ok(!threadHeading(thread).includes('September'));
});

test('multi-day events show a date range, within a month and across months', async () => {
  assert.equal(threadHeading(await forum.getThread('t-e4')), 'Fall weekend from October 3–5, 2026');
  assert.equal(threadHeading(await forum.getThread('t-e3')), 'Fall fest from October 30 – November 2, 2026');
  assert.match(threadDescription(await forum.getThread('t-e3')), /^Event runs October 30 – November 2, 2026\./);
});

test('date-only values never shift to the previous day', async () => {
  // Read as UTC midnight in Eastern time, Jan. 1 would show as Dec. 31.
  assert.equal(threadHeading(await forum.getThread('t-e5')), 'First day hike on Friday, January 1, 2027');
});

test('all-day events (no times involved) read the same as timed ones', () => {
  assert.equal(eventWhen({ title: 'x', kind: 'event', event_starts_on: '2026-10-14', event_ends_on: null }), 'Wednesday, October 14, 2026');
});

test('story and community discussions keep their existing presentation', async () => {
  const story = await forum.getThread('t-a1');
  assert.equal(threadHeading(story), 'A story');
  assert.equal(threadDescription(story), 'Story summary');
  const community = await forum.getThread('t-c');
  assert.equal(threadHeading(community), 'Reader topic');
  assert.equal(threadDescription(community), 'Reader body');
});

test('the listing carries the event dates too, and draft events stay hidden', async () => {
  database.prepare(`INSERT INTO events VALUES ('d', 'draft', 'Draft', 's', 'draft', '2026-12-01', NULL)`).run();
  database.prepare(`INSERT INTO forum_threads VALUES ('t-d', 'newsroom', 'x', 'x', 'published', NULL, 'd', ?, ?, ?)`).run(created, created, created);
  const listed = await forum.listThreads(0, '', 'event');
  assert.equal(listed.length, 5);
  assert.ok(listed.every((t) => t.event_starts_on));
  assert.equal(await forum.getThread('t-d'), null);
});
