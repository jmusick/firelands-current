import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { Miniflare } from 'miniflare';
import { publishFacebookStories, reconcileFacebookPosts } from '../src/lib/facebook-publisher.ts';

const PAGE = '1342964875571057';
const NOW = 1791000000000;
function setup({ archive = false } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const migrationFiles = readdirSync(new URL('../migrations/', import.meta.url)).sort();
  for (const file of migrationFiles.filter(name => name < '0018')) sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const article = (id, status = 'published', publishedAt = NOW - 1000) => sql.prepare(`INSERT INTO news_articles
    (id, slug, headline, summary, body, section, community, byline, status, published_at, created_at, updated_at)
    VALUES (?, ?, ?, 'A summary for readers.', 'Story body.', 'local', 'Sandusky', 'JD', ?, ?, ?, ?)`).run(id, id, `Headline ${id}`, status, publishedAt, NOW, NOW);
  if (archive) article('archive');
  sql.exec(readFileSync(new URL('../migrations/0018_facebook_posts.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(query) {
      let values = [];
      const statement = sql.prepare(query);
      const prepared = {
        bind(...args) { values = args; return prepared; },
        async all() { return { results: statement.all(...values), meta: { changes: 0 } }; },
        async first() { return statement.get(...values) ?? null; },
        async run() { return { meta: statement.run(...values) }; },
      };
      return prepared;
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  const config = { DB: db, SITE_URL: 'https://firelandscurrent.com', FACEBOOK_AUTO_POST_ENABLED: 'true', FACEBOOK_PAGE_ID: PAGE,
    FACEBOOK_GRAPH_VERSION: 'v26.0', FACEBOOK_PAGE_ACCESS_TOKEN: 'fake-secret', FACEBOOK_TOKEN_EXPIRES_AT: String(NOW + 86400000) };
  const post = id => sql.prepare('SELECT * FROM facebook_posts WHERE article_id = ?').get(id);
  // SQLite triggers use wall time; place newly queued rows in the test clock's due window.
  const due = () => sql.prepare('UPDATE facebook_posts SET next_attempt_at = ?').run(NOW - 1);
  return { sql, db, config, article, post, due };
}
const json = (value, status = 200) => Response.json(value, { status });
function fakeGraph(callback = () => json({ id: `${PAGE}_12345` })) {
  const calls = [];
  const fetch = async (url, options) => {
    if (options?.method !== 'POST') return json({ id: PAGE, can_post: true });
    calls.push({ url, options });
    return callback(url, options);
  };
  return { calls, fetch };
}
const run = (fixture, graph, now = NOW) => publishFacebookStories(fixture.config, { fetch: graph.fetch, now: () => now });

test('publisher request options work in the Cloudflare runtime without following redirects', async () => {
  const publisher = ts.transpileModule(readFileSync(new URL('../src/lib/facebook-publisher.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const campaign = ts.transpileModule(readFileSync(new URL('../src/lib/campaign.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const script = `import { publishFacebookStories } from './publisher.js';
    export default { async fetch() {
      let claimed = false;
      const DB = { prepare(query) { return { bind() { return this; }, async run() { return {}; }, async first() {
        if (query.includes('RETURNING article_id')) { if (claimed) return null; claimed = true; return { article_id: 'story', attempts: 1 }; }
        return { slug: 'story', headline: 'Headline', summary: 'Summary', status: 'published', published_at: 1 };
      } }; } };
      let requests = 0;
      const result = await publishFacebookStories({ DB, SITE_URL: 'https://firelandscurrent.com', FACEBOOK_AUTO_POST_ENABLED: 'true',
        FACEBOOK_PAGE_ID: '${PAGE}', FACEBOOK_GRAPH_VERSION: 'v26.0', FACEBOOK_PAGE_ACCESS_TOKEN: 'fake-secret', FACEBOOK_TOKEN_EXPIRES_AT: '${NOW + 86400000}' },
        { now: () => ${NOW}, fetch: async (url, options) => {
          const request = new Request(url, options);
          if (request.redirect !== 'manual') throw new Error('Credentials must not follow redirects');
          requests++;
          return Response.json(request.method === 'POST' ? { id: '${PAGE}_12345' } : { id: '${PAGE}', can_post: true });
        } });
      return Response.json({ ...result, requests });
    } };`;
  const runtime = new Miniflare({ workers: [{ config: { name: 'facebook-test', compatibilityDate: '2026-09-26',
    manifest: { mainModule: 'test.js', modules: { 'test.js': { type: 'esm', contents: script }, 'publisher.js': { type: 'esm', contents: publisher }, 'campaign.ts': { type: 'esm', contents: campaign } } } } }] });
  try {
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/')).json(), { posted: 1, paused: false, requests: 2 });
  } finally { await runtime.dispose(); }
});

test('archive is reviewed; new published stories and draft transitions queue atomically', () => {
  const f = setup({ archive: true });
  assert.equal(f.post('archive').status, 'review');
  f.article('new'); f.article('draft', 'draft');
  assert.equal(f.post('new').status, 'pending');
  assert.equal(f.post('draft'), undefined);
  f.sql.prepare("UPDATE news_articles SET status = 'published' WHERE id = 'draft'").run();
  assert.equal(f.post('draft').status, 'pending');
});

test('success records the correct Page post; edits and republishing do not repost', async () => {
  const f = setup(); f.article('one'); f.due();
  const graph = fakeGraph();
  assert.equal((await run(f, graph)).posted, 1);
  const request = graph.calls[0];
  assert.equal(request.url, `https://graph.facebook.com/v26.0/${PAGE}/feed`);
  assert.equal(request.options.body.get('link'), 'https://firelandscurrent.com/news/one?utm_source=facebook&utm_medium=social&utm_campaign=story_share');
  assert.equal(f.post('one').article_url, 'https://firelandscurrent.com/news/one');
  assert.equal(request.options.body.get('message'), 'Headline one\n\nA summary for readers.');
  assert.equal(request.options.headers.Authorization, 'Bearer fake-secret');
  assert.equal(request.url.includes('fake-secret'), false);
  f.sql.prepare("UPDATE news_articles SET status = 'draft' WHERE id = 'one'").run();
  f.sql.prepare("UPDATE news_articles SET status = 'published', headline = 'Edited headline' WHERE id = 'one'").run();
  await run(f, graph);
  assert.equal(graph.calls.length, 1);
  assert.equal(f.post('one').post_id, `${PAGE}_12345`);
});

test('overlapping publisher runs cannot claim the same story', async () => {
  const f = setup(); f.article('race'); f.due();
  const graph = fakeGraph();
  await Promise.all([run(f, graph), run(f, graph)]);
  assert.equal(graph.calls.length, 1);
  assert.equal(f.post('race').status, 'posted');
});

test('unpublished and future stories are not sent', async () => {
  const f = setup(); f.article('unpublish'); f.article('future', 'published', NOW + 86400000); f.due();
  f.sql.prepare("UPDATE news_articles SET status = 'draft' WHERE id = 'unpublish'").run();
  const graph = fakeGraph(); await run(f, graph);
  assert.equal(graph.calls.length, 0);
  assert.equal(f.post('unpublish').status, 'pending');
});

test('reconciliation finds missing stories regardless of feed size', async () => {
  const f = setup();
  for (let i = 0; i < 41; i++) f.article(`import-${i}`);
  f.sql.exec('DELETE FROM facebook_posts');
  await reconcileFacebookPosts(f.db, NOW);
  await reconcileFacebookPosts(f.db, NOW);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM facebook_posts').get().n, 41);
});

test('network loss, unreadable responses and server errors require checking Facebook', async () => {
  for (const callback of [() => { throw new Error('Network lost fake-secret'); }, () => new Response('not json'), () => json(null), () => json({ id: '9999_12345' }), () => json({ error: { code: 2 } }, 500)]) {
    const f = setup(); f.article('ambiguous'); f.due(); const graph = fakeGraph(callback);
    await run(f, graph); await run(f, graph, NOW + 86400000);
    assert.equal(f.post('ambiguous').status, 'uncertain');
    assert.equal(graph.calls.length, 1);
    assert.equal(f.post('ambiguous').last_error.includes('fake-secret'), false);
  }
});

test('rate limits back off, stop the run, and stop retrying after six rejections', async () => {
  const f = setup(); f.article('rate'); f.article('later'); f.due();
  // Ensure the first story is deterministic.
  f.sql.prepare("UPDATE news_articles SET published_at = ? WHERE id = 'rate'").run(NOW - 2000);
  const graph = fakeGraph(() => json({ error: { code: 4, message: 'fake-secret' } }, 429));
  await run(f, graph);
  assert.equal(graph.calls.length, 1);
  assert.equal(f.post('rate').status, 'pending');
  assert.equal(f.post('rate').next_attempt_at, NOW + 120000);
  await run(f, graph, NOW + 60000);
  assert.equal(f.post('rate').attempts, 1);
  f.sql.prepare("UPDATE facebook_posts SET attempts = 5, next_attempt_at = ? WHERE article_id = 'rate'").run(NOW - 1);
  await run(f, graph);
  assert.equal(f.post('rate').status, 'failed');
});

test('permission failures leave remaining stories queued and keep raw errors out of storage', async () => {
  const f = setup(); f.article('a'); f.article('b'); f.due();
  const graph = fakeGraph(() => json({ error: { code: 190, error_subcode: 463, message: 'Invalid fake-secret' } }, 400));
  await run(f, graph);
  assert.equal(graph.calls.length, 1);
  assert.equal(f.post('a').status, 'failed');
  assert.equal(f.post('b').status, 'pending');
  assert.equal(f.post('a').last_error, 'Facebook rejected the post (code 190, subcode 463).');
});

test('disabled, missing, expired and local configurations never contact Meta', async () => {
  for (const override of [{ FACEBOOK_AUTO_POST_ENABLED: 'false' }, { FACEBOOK_PAGE_ACCESS_TOKEN: '' }, { FACEBOOK_TOKEN_EXPIRES_AT: String(NOW) }, { SITE_URL: 'http://127.0.0.1:4321' }]) {
    const f = setup(); f.article('off'); f.due(); Object.assign(f.config, override);
    const result = await publishFacebookStories(f.config, { now: () => NOW, fetch: async () => { throw new Error('Unexpected Meta request'); } });
    assert.equal(result.paused, true);
    assert.equal(f.post('off').attempts, 0);
  }
});

test('wrong Page identity blocks posting before a story is claimed', async () => {
  const f = setup(); f.article('wrong'); f.due();
  const result = await publishFacebookStories(f.config, { now: () => NOW, fetch: async () => json({ id: '9999', can_post: true }) });
  assert.equal(result.paused, true);
  assert.equal(f.post('wrong').status, 'pending');
  assert.equal(f.post('wrong').attempts, 0);
});

test('identity errors retain only safe status and numeric codes', async () => {
  const f = setup(); f.article('invalid-token'); f.due();
  const result = await publishFacebookStories(f.config, { now: () => NOW, fetch: async () => json({ error: { code: 190, message: 'secret token must not appear' } }, 400) });
  assert.equal(result.paused, true);
  const health = f.sql.prepare('SELECT last_error FROM facebook_publisher_health').get();
  assert.match(health.last_error, /HTTP 400, code 190/);
  assert.doesNotMatch(health.last_error, /secret token/);
  assert.equal(f.post('invalid-token').attempts, 0);
});

test('a busy run sends at most five stories and leaves the rest for the next check', async () => {
  const f = setup();
  for (let i = 0; i < 7; i++) f.article(`busy-${i}`);
  f.due();
  let nextId = 0;
  const graph = fakeGraph(() => json({ id: `${PAGE}_${++nextId}` }));
  assert.equal((await run(f, graph)).posted, 5);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM facebook_posts WHERE status = 'pending'").get().n, 2);
  assert.equal((await run(f, graph)).posted, 2);
});

test('database failure after a successful Meta write becomes uncertain without replaying', async () => {
  const f = setup(); f.article('db-loss'); f.due();
  const prepare = f.db.prepare;
  let fail = true;
  f.db.prepare = query => {
    const statement = prepare(query);
    if (query.includes('post_id = COALESCE') && fail) statement.run = async () => { throw new Error('Database unavailable'); };
    return statement;
  };
  const graph = fakeGraph();
  await assert.rejects(run(f, graph));
  fail = false;
  await run(f, graph, NOW + 6 * 60000);
  assert.equal(f.post('db-loss').status, 'uncertain');
  assert.equal(graph.calls.length, 1);
});

test('archive actions are audited atomically; posting and posted records cannot be queued', async () => {
  const f = setup({ archive: true });
  f.sql.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run('editor-test', 'Test editor', 'test@example.test', String(NOW), String(NOW));
  globalThis.__facebookTestEnv = f.config;
  let source = ts.transpileModule(readFileSync(new URL('../src/lib/facebook-admin.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace("'cloudflare:workers'", JSON.stringify(`data:text/javascript,export const env = globalThis.__facebookTestEnv;`))
    .replace("'./facebook-publisher'", JSON.stringify(new URL('../src/lib/facebook-publisher.ts', import.meta.url).href));
  const { resolveFacebookPost } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const actor = { id: 'editor-test', name: 'Test editor' };
  assert.equal(await resolveFacebookPost(actor, 'archive', 'queue', ''), true);
  assert.equal(await resolveFacebookPost(actor, 'archive', 'queue', ''), false);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM admin_audit_log').get().n, 1);
  assert.equal(await resolveFacebookPost(actor, 'archive', 'record', '9999_1234'), false);
  assert.equal(await resolveFacebookPost(actor, 'archive', 'record', `${PAGE}_8888`), true);
  assert.equal(await resolveFacebookPost(actor, 'archive', 'queue', ''), false);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM admin_audit_log').get().n, 2);
  f.article('claimed'); f.sql.prepare("UPDATE facebook_posts SET status = 'posting' WHERE article_id = 'claimed'").run();
  assert.equal(await resolveFacebookPost(actor, 'claimed', 'record', `${PAGE}_9999`), false);
});

test('resolution endpoints reject unsigned users, moderators, cross-origin requests and missing confirmation', async () => {
  function moduleUrl(path, replacements = {}) {
    let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    }).outputText;
    for (const [specifier, replacement] of Object.entries(replacements)) source = source.replace(JSON.stringify(specifier), JSON.stringify(replacement)).replace(`'${specifier}'`, JSON.stringify(replacement));
    return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  }
  const adminUrl = moduleUrl('src/lib/admin.ts');
  const forumUrl = moduleUrl('src/lib/forum.ts', { 'cloudflare:workers': 'data:text/javascript,export const env = {};' });
  const bodyUrl = moduleUrl('src/lib/request-body.ts');
  // Denied attempts by signed-in accounts are recorded; this fake database captures what would be written.
  const denied = [];
  globalThis.__facebookDenied = { DB: { prepare: () => ({ bind: (...values) => ({ run: async () => { denied.push(values); } }) }) } };
  const auditUrl = moduleUrl('src/lib/audit.ts', { 'cloudflare:workers': 'data:text/javascript,export const env = globalThis.__facebookDenied;' });
  const { POST } = await import(moduleUrl('src/pages/api/admin/facebook/resolve.ts', {
    '../../../../lib/audit': auditUrl,
    '../../../../lib/admin': adminUrl,
    '../../../../lib/forum': forumUrl,
    '../../../../lib/request-body': bodyUrl,
    '../../../../lib/facebook-admin': 'data:text/javascript,export const resolveFacebookPost = () => { throw new Error("Unauthorized mutation"); };',
  }));
  const request = (origin, checked = true) => new Request('https://firelandscurrent.com/api/admin/facebook/resolve', {
    method: 'POST', headers: origin ? { origin } : {}, body: new URLSearchParams({ id: 'story', action: 'queue', ...(checked ? { checked_page: '1' } : {}) }),
  });
  for (const locals of [{ user: null, staffRole: null }, { user: { id: 'user' }, staffRole: null }, { user: { id: 'moderator' }, staffRole: 'moderator' }]) {
    assert.equal((await POST({ request: request('https://firelandscurrent.com'), locals })).status, 403);
  }
  // Only the two signed-in accounts left a record; the signed-out request has no one to attribute it to.
  assert.deepEqual(denied.map((values) => [values[1], values[4], values[5]]), [
    ['user', 'facebook-resolve', 'Needs a staff role this account lacks (account role: none)'],
    ['moderator', 'facebook-resolve', 'Needs a staff role this account lacks (account role: moderator)'],
  ]);
  denied.length = 0;
  const locals = { user: { id: 'editor' }, staffRole: 'editor' };
  assert.equal((await POST({ request: request('https://other.example'), locals })).status, 403);
  assert.equal((await POST({ request: request(null), locals })).status, 403);
  assert.deepEqual(denied.map((values) => [values[1], values[4], values[5]]), [
    ['editor', 'facebook-resolve', 'Cross-origin request refused'], ['editor', 'facebook-resolve', 'Cross-origin request refused'],
  ]);
  delete globalThis.__facebookDenied;
  assert.equal((await POST({ request: request('https://firelandscurrent.com', false), locals })).status, 400);
});

test("campaignUrl tags links and replaces existing UTM parameters", async () => {
  const { campaignUrl } = await import("../src/lib/campaign.ts");
  assert.equal(campaignUrl("https://firelandscurrent.com/news/a", { source: "newsletter", medium: "email", campaign: "weekly" }),
    "https://firelandscurrent.com/news/a?utm_source=newsletter&utm_medium=email&utm_campaign=weekly");
  assert.equal(campaignUrl("https://firelandscurrent.com/news/a?page=2&utm_source=old", { source: "facebook", medium: "social", campaign: "story_share" }),
    "https://firelandscurrent.com/news/a?page=2&utm_source=facebook&utm_medium=social&utm_campaign=story_share");
});
