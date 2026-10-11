import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { Miniflare } from 'miniflare';

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
  // Statements run in order, as a D1 batch does; the changes() audit guards depend on that.
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
};
globalThis.__newsTestEnv = { DB: db };
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__newsTestEnv;')}`;
async function loadSource(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return { url, module: await import(url) };
}
const news = await loadSource('src/lib/news.ts');
const forum = await loadSource('src/lib/forum.ts');
const audit = await loadSource('src/lib/audit.ts');
const { emptyArticle, saveArticleFromForm, valuesFromArticle } = (await loadSource('src/lib/news-admin.ts', {
  './news': news.url, './forum': forum.url, './audit': audit.url,
  './media': 'data:text/javascript,export const isMediaId = () => false;',
})).module;
const { frontPageArticles, getAdminArticle } = news.module;
const actor = { id: 'editor', name: 'Test editor' };
const save = (data, existing) => saveArticleFromForm(data, existing, actor);
const userSql = "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('editor', 'Test editor', 'editor@example.test', 1, '2026-10-01', '2026-10-01')";
database.exec(userSql);
const auditRows = (where = '1 = 1') => database.prepare(`SELECT actor_id, actor_name, target_type, target_id, target_label, action, detail, outcome FROM admin_audit_log WHERE ${where} ORDER BY rowid`).all().map((row) => ({ ...row }));

const insert = (id, publishedAt, featured = 0, status = 'published') => database.prepare(`
  INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, published_at, created_at, updated_at, featured)
  VALUES (?, ?, ?, 'A summary long enough to save.', 'Story text long enough to save.', 'local', 'Sandusky', 'Test reporter', ?, ?, 1, 1, ?)
`).run(id, id, `Story about ${id}`, status, publishedAt, featured);
const form = (article, featured) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...emptyArticle, ...valuesFromArticle(article) })) {
    if (key !== 'featured') data.set(key, value);
  }
  if (featured) data.set('featured', '1');
  return data;
};

test('featured homepage stories', async (t) => {
  await t.test('empty database has no lead or latest stories', async () => {
    assert.deepEqual(await frontPageArticles(), { lead: null, more: [] });
  });
  for (let i = 1; i <= 7; i++) insert(`recent-${i}`, 100 + i);
  insert('old-feature-a', 1);
  insert('old-feature-b', 2);
  insert('draft-feature', 200, 1, 'draft');
  const queueBefore = database.prepare('SELECT * FROM facebook_posts ORDER BY article_id').all();

  await t.test('no published featured story falls back to newest, with no duplicate lead', async () => {
    const page = await frontPageArticles();
    assert.equal(page.lead.id, 'recent-7');
    assert.deepEqual(page.more.map((a) => a.id), ['recent-6', 'recent-5', 'recent-4', 'recent-3']);
    assert.equal((await frontPageArticles(0)).more.length, 0);
  });

  await t.test('saving multiple featured stories preserves the others and original publication dates', async () => {
    for (const id of ['old-feature-a', 'old-feature-b', 'recent-7']) {
      const article = await getAdminArticle(id);
      assert.equal((await save(form(article, true), article)).ok, true);
      assert.equal((await getAdminArticle(id)).published_at, article.published_at);
    }
    assert.deepEqual(database.prepare("SELECT id FROM news_articles WHERE featured = 1 AND status = 'published' ORDER BY id").all().map((a) => a.id),
      ['old-feature-a', 'old-feature-b', 'recent-7']);
    assert.deepEqual(database.prepare('SELECT * FROM facebook_posts ORDER BY article_id').all(), queueBefore);
    assert.equal(database.prepare("SELECT created_at FROM news_articles WHERE id = 'old-feature-a'").get().created_at, 1);
  });

  await t.test('each featured story can lead, while Latest always contains the newest other stories', async () => {
    // Control SQLite's random values to exercise each outcome without a probabilistic test.
    let randomIndex = 0;
    let randomValues = [];
    database.function('random', () => randomValues[randomIndex++]);
    const selected = new Set();
    for (let chosen = 0; chosen < 3; chosen++) {
      randomIndex = 0;
      randomValues = [1, 1, 1];
      randomValues[chosen] = -1;
      const page = await frontPageArticles();
      selected.add(page.lead.id);
      const newestOthers = database.prepare("SELECT id FROM news_articles WHERE status = 'published' AND id != ? ORDER BY published_at DESC LIMIT 4")
        .all(page.lead.id).map((a) => a.id);
      assert.deepEqual(page.more.map((a) => a.id), newestOthers);
    }
    assert.deepEqual([...selected].sort(), ['old-feature-a', 'old-feature-b', 'recent-7']);
  });

  await t.test('unticking a story preserves other featured stories; unpublishing excludes it', async () => {
    const first = await getAdminArticle('old-feature-a');
    assert.equal((await save(form(first, false), first)).ok, true);
    const second = await getAdminArticle('old-feature-b');
    const data = form(second, true);
    data.set('status', 'draft');
    assert.equal((await save(data, second)).ok, true);
    database.function('random', () => 0);
    assert.equal((await frontPageArticles()).lead.id, 'recent-7');
    assert.equal((await getAdminArticle('recent-7')).featured, 1);
  });

  await t.test('new featured stories save without clearing the existing selection', async () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ ...emptyArticle, headline: 'A newly featured story', slug: 'new-feature',
      summary: 'A summary long enough to save.', body: 'Story text long enough to save.', section: 'local',
      community: 'Sandusky', byline: 'Test reporter', status: 'published', featured: '1' })) data.set(key, value);
    const saved = await save(data, null);
    assert.equal(saved.ok, true);
    assert.equal((await getAdminArticle(saved.id)).featured, 1);
    assert.equal((await getAdminArticle('recent-7')).featured, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM facebook_posts WHERE article_id = ?').get(saved.id).n, 1);
  });

  await t.test('published edits and featured selection work in the Cloudflare D1 runtime', async () => {
    const runtime = new Miniflare({ workers: [{ config: {
      name: 'featured-news-test', compatibilityDate: '2026-09-26', env: { DB: { type: 'd1', id: 'featured-news-test' } },
      manifest: { mainModule: 'test.js', modules: { 'test.js': { type: 'esm', contents: 'export default { fetch() { return new Response("ok"); } };' } } },
    } }] });
    try {
      const runtimeDb = await runtime.getD1Database('DB');
      for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
        const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
        await runtimeDb.exec(sql.replace(/--[^\r\n]*/g, '').replace(/\r?\n/g, ' '));
      }
      await runtimeDb.exec(userSql);
      globalThis.__newsTestEnv.DB = runtimeDb;
      for (const id of ['runtime-a', 'runtime-b']) {
        const data = new FormData();
        for (const [key, value] of Object.entries({ ...emptyArticle, headline: `A story about ${id}`, slug: id,
          summary: 'A summary long enough to save.', body: 'Story text long enough to save.', section: 'local',
          community: 'Sandusky', byline: 'Test reporter', status: 'published' })) data.set(key, value);
        const saved = await save(data, null);
        assert.equal(saved.ok, true);
        const queue = await runtimeDb.prepare('SELECT * FROM facebook_posts WHERE article_id = ?').bind(saved.id).first();
        const article = await getAdminArticle(saved.id);
        assert.equal((await save(form(article, true), article)).ok, true);
        assert.deepEqual(await runtimeDb.prepare('SELECT * FROM facebook_posts WHERE article_id = ?').bind(saved.id).first(), queue);
        // The create, publish and feature entries committed with their saves in D1's own batch.
        const actions = (await runtimeDb.prepare('SELECT action FROM admin_audit_log WHERE target_id = ? ORDER BY rowid').bind(saved.id).all()).results.map((row) => row.action);
        assert.deepEqual(actions, ['story-create', 'story-publish', 'story-feature']);
      }
      assert.equal((await runtimeDb.prepare('SELECT COUNT(*) AS n FROM news_articles WHERE featured = 1').first()).n, 2);
      const page = await frontPageArticles();
      assert.ok(['runtime-a', 'runtime-b'].includes(page.lead.slug));
      assert.equal(page.more.length, 1);
      assert.notEqual(page.more[0].id, page.lead.id);
    } finally {
      globalThis.__newsTestEnv.DB = db;
      await runtime.dispose();
    }
  });
});

test('story saves are audited with changed field names, never story text', async (t) => {
  database.exec('DELETE FROM admin_audit_log');
  const base = { ...emptyArticle, headline: 'An audited story headline', slug: 'audited-story', summary: 'A summary long enough to save.',
    body: 'SECRET body text that must not reach the log.', section: 'local', community: 'Sandusky', byline: 'Test reporter' };
  const submit = (overrides, existing) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ ...base, ...overrides })) data.set(key, value);
    return save(data, existing);
  };
  let id;

  await t.test('a new draft records who created it and nothing else', async () => {
    const saved = await submit({}, null);
    assert.equal(saved.ok, true);
    id = saved.id;
    assert.deepEqual(auditRows(), [{ actor_id: 'editor', actor_name: 'Test editor', target_type: 'story', target_id: id,
      target_label: 'An audited story headline', action: 'story-create', detail: '/news/audited-story; draft', outcome: 'success' }]);
  });

  await t.test('edits list only the fields that changed', async () => {
    const draft = await getAdminArticle(id);
    assert.equal((await submit({ headline: 'A revised audited story headline', body: 'SECRET revised text.' }, draft)).ok, true);
    const rows = auditRows("action != 'story-create'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'story-update');
    assert.equal(rows[0].detail, 'Changed: headline, story text');
    assert.equal(rows[0].target_label, 'A revised audited story headline');
  });

  await t.test('publishing and featuring are their own entries, and an unchanged save adds none', async () => {
    database.exec('DELETE FROM admin_audit_log');
    const draft = await getAdminArticle(id);
    assert.equal((await submit({ headline: draft.headline, body: draft.body, status: 'published', featured: '1' }, draft)).ok, true);
    assert.deepEqual(auditRows().map((row) => row.action), ['story-publish', 'story-feature']);
    const live = await getAdminArticle(id);
    assert.equal((await submit({ headline: live.headline, body: live.body, status: 'published', featured: '1' }, live)).ok, true);
    assert.equal(auditRows().length, 2);
    assert.equal((await submit({ headline: live.headline, body: live.body, status: 'draft' }, live)).ok, true);
    assert.deepEqual(auditRows().map((row) => row.action), ['story-publish', 'story-feature', 'story-unpublish', 'story-unfeature']);
  });

  await t.test('a rejected save changes and records nothing', async () => {
    database.exec('DELETE FROM admin_audit_log');
    assert.equal((await submit({ headline: 'Short' }, await getAdminArticle(id))).ok, false);
    assert.equal(auditRows().length, 0);
  });

  await t.test('no entry holds story text', async () => {
    database.exec('DELETE FROM admin_audit_log');
    const article = await getAdminArticle(id);
    assert.equal((await submit({ headline: article.headline, body: 'SECRET text written in the last edit.', summary: 'SECRET summary that is long enough.' }, article)).ok, true);
    assert.equal(auditRows().length, 1);
    assert.doesNotMatch(JSON.stringify(auditRows()), /SECRET/);
  });
});
