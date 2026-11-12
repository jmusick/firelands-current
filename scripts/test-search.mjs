import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

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
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.all());
    return results;
  },
};
globalThis.__searchTestEnv = { DB: db };
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__searchTestEnv;')}`;
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
const { MAX_QUERY_LENGTH, likePattern, normalizeQuery, queryTerms, searchSite } = (await loadSource('src/lib/search.ts', { './news': news.url })).module;

const NOW = Date.parse('2026-11-11T15:00:00Z');
const DAY = 86400000;
const story = (slug, { headline = `Story ${slug}`, summary = 'A summary.', body = 'Story text.', community = 'Sandusky', status = 'published', publishedAt = NOW - DAY } = {}) =>
  database.prepare(`
    INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, published_at, created_at, updated_at)
    VALUES (?1, ?1, ?2, ?3, ?4, 'local', ?5, 'Test reporter', ?6, ?7, 1, 1)
  `).run(slug, headline, summary, body, community, status, publishedAt);
const event = (slug, { title = `Event ${slug}`, summary = 'An event.', description = '', community = 'Sandusky', status = 'published', startsOn = '2026-11-20' } = {}) =>
  database.prepare(`
    INSERT INTO events (id, slug, title, summary, description, category, starts_on, venue, community, status, created_at, updated_at)
    VALUES (?1, ?1, ?2, ?3, ?4, 'community', ?5, 'Town hall', ?6, ?7, 1, 1)
  `).run(slug, title, summary, description, startsOn, community, status);
const search = async (q, page = 0, pageSize) => searchSite(normalizeQuery(q), page, NOW, pageSize);
const slugs = async (q, page, pageSize) => (await search(q, page, pageSize)).results.map((r) => r.slug);

story('leaf-pickup', { headline: 'Sandusky leaf pickup starts Monday', summary: 'Crews collect bagged leaves by ward.', publishedAt: NOW - 18 * DAY });
story('leaf-art', { headline: 'Leaf art at the library', body: 'Children glue autumn leaves. Pickup is at noon.', publishedAt: NOW - 2 * DAY });
story('pickup-trucks', { headline: 'Pickup trucks at the county fair', publishedAt: NOW - 3 * DAY });
story('pumpkin-draft', { headline: 'Pumpkin hunt draft', status: 'draft' });
story('pumpkin-future', { headline: 'Pumpkin hunt preview', publishedAt: NOW + DAY });
story('pumpkin-story', { headline: 'Pumpkin hunt returns to Huron', community: 'Huron', publishedAt: NOW - 30 * DAY });
story('discount', { headline: 'Shoppers save 50% at the market', body: 'A sale on snake_case signs.' });
story('discount-plain', { headline: 'Shoppers save 500 dollars', body: 'A sale on snakeXcase signs.' });
story('milan-council', { headline: 'Village council meets', community: 'Milan' });
event('pumpkin-hunt', { title: 'Great pumpkin hunt', community: 'Huron', startsOn: '2026-10-25' });
event('pumpkin-draft-event', { title: 'Pumpkin carving draft', status: 'draft' });
event('pumpkin-cancelled', { title: 'Pumpkin roll', status: 'cancelled', startsOn: '2026-10-30' });
event('craft-fair', { title: 'Holiday craft fair', description: 'Wreaths and **pumpkin** bread.' });

test('every term must match one of the searched fields', async () => {
  assert.deepEqual(await slugs('leaf pickup'), ['leaf-pickup', 'leaf-art']);
  assert.deepEqual(await slugs('LEAF'), ['leaf-art', 'leaf-pickup']);
  assert.deepEqual(await slugs('milan'), ['milan-council'], 'community counts as a match');
  assert.deepEqual(await slugs('leaf trucks'), []);
});

test('headline matches outrank body matches, then newer first', async () => {
  // Both terms in leaf-pickup's headline; leaf-art matches "pickup" only in its body.
  const results = (await search('leaf pickup')).results;
  assert.equal(results[0].slug, 'leaf-pickup');
  assert.equal(results[0].kind, 'story');
  assert.equal(results[0].title, 'Sandusky leaf pickup starts Monday');
  assert.equal(results[0].byline, 'Test reporter');
});

test('% and _ are matched literally, not as wildcards', async () => {
  assert.deepEqual(await slugs('50%'), ['discount']);
  assert.deepEqual(await slugs('snake_case'), ['discount']);
  assert.equal(likePattern('a%b_c\\d'), '%a\\%b\\_c\\\\d%');
  assert.deepEqual(await slugs('\\\\'), [], 'backslashes are literal too');
});

test('drafts, future-dated stories, and draft events stay out; cancelled events stay in', async () => {
  const found = await slugs('pumpkin');
  assert.deepEqual(found.sort(), ['craft-fair', 'pumpkin-cancelled', 'pumpkin-hunt', 'pumpkin-story']);
  const events = (await search('pumpkin')).results.filter((r) => r.kind === 'event');
  assert.deepEqual(events.map((r) => [r.slug, r.status, r.venue]).sort(), [
    ['craft-fair', 'published', 'Town hall'], ['pumpkin-cancelled', 'cancelled', 'Town hall'], ['pumpkin-hunt', 'published', 'Town hall'],
  ]);
});

test('short, long and messy queries are normalized', async () => {
  assert.equal(normalizeQuery(null), '');
  assert.equal(normalizeQuery(' a '), '', 'one character is too short');
  assert.equal(normalizeQuery('  leaf \n\t pickup  '), 'leaf pickup');
  assert.equal(normalizeQuery('x'.repeat(250)).length, MAX_QUERY_LENGTH);
  assert.equal(Array.from(normalizeQuery('🍂'.repeat(150))).length, MAX_QUERY_LENGTH, 'the cap counts characters, not UTF-16 units');
  assert.deepEqual(queryTerms('one two three four five six seven'), ['one', 'two', 'three', 'four', 'five']);
  assert.deepEqual(queryTerms('Leaf leaf LEAF'), ['leaf']);
  assert.deepEqual(await search(''), { results: [], total: 0 });
  assert.deepEqual(await search('x'), { results: [], total: 0 });
  // Only the first five terms count, so a sixth that matches nothing doesn't empty the results.
  assert.deepEqual(await slugs('sandusky leaf pickup starts monday zzzz'), ['leaf-pickup']);
});

test('paging returns each match once and reports the total', async () => {
  const all = await search('pumpkin');
  assert.equal(all.total, 4);
  const pages = [await search('pumpkin', 0, 3), await search('pumpkin', 1, 3), await search('pumpkin', 2, 3)];
  assert.deepEqual(pages.map((p) => p.total), [4, 4, 4]);
  assert.deepEqual(pages.map((p) => p.results.length), [3, 1, 0]);
  assert.deepEqual(pages.flatMap((p) => p.results.map((r) => r.slug)), all.results.map((r) => r.slug));
});
