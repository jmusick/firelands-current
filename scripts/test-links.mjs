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
    database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};
globalThis.__linksTestEnv = { DB: db };
function moduleUrl(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => `from ${JSON.stringify(
    specifier === 'cloudflare:workers' ? 'data:text/javascript,export const env = globalThis.__linksTestEnv;' : replacements[specifier] ?? import.meta.resolve(specifier),
  )}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const forum = moduleUrl('src/lib/forum.ts');
const audit = moduleUrl('src/lib/audit.ts');
const linksUrl = moduleUrl('src/lib/links.ts', { './forum': forum, './audit': audit });
const links = await import(linksUrl);
const body = moduleUrl('src/lib/request-body.ts');
const admin = moduleUrl('src/lib/admin.ts');
const { POST } = await import(moduleUrl('src/pages/api/admin/links.ts', {
  '../../../lib/links': linksUrl, '../../../lib/forum': forum, '../../../lib/audit': audit,
  '../../../lib/request-body': body, '../../../lib/admin': admin,
}));
database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
  .run('links-editor', 'Directory editor', 'links@example.test', '2026-01-01', '2026-01-01');
const actor = { id: 'links-editor', name: 'Directory editor' };
const form = (overrides = {}) => {
  const fields = { name: 'Official library', url: 'https://example.test/library', county: 'erie', community: 'Sandusky',
    category: 'library', description: '', checked_on: '2026-01-01', status: 'draft', ...overrides };
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) result.set(key, value);
  return result;
};
const entries = (id) => database.prepare('SELECT action, actor_id, target_label, detail FROM admin_audit_log WHERE target_id = ? ORDER BY rowid').all(id);
test.after(() => { database.close(); delete globalThis.__linksTestEnv; });

test('initial destinations cover all six counties and include libraries without a business category', async () => {
  const initial = await links.listLinks(true);
  assert.equal(initial.length, 54);
  assert.deepEqual(new Set(initial.map((link) => link.county)), new Set(Object.keys(links.COUNTIES)));
  assert.ok(initial.some((link) => link.category === 'library'));
  assert.ok(!Object.hasOwn(links.LINK_TYPES, 'business'));
  for (const link of initial) assert.deepEqual(links.readLinkValues(form(link)).errors, [], link.name);
});

test('create, read, update, publish, unpublish and delete keep drafts private and retain attributed audit entries', async () => {
  const created = await links.saveLinkFromForm(form({ community: '  sandusky  ' }), null, actor);
  assert.ok(created.ok);
  const original = await links.getLink(created.id);
  assert.equal(original.community, 'Sandusky');
  assert.ok((await links.listLinks()).some((link) => link.id === created.id));
  assert.ok(!(await links.listLinks(true)).some((link) => link.id === created.id));
  const published = await links.saveLinkFromForm(form({ name: 'Renamed library', status: 'published' }), original, actor);
  assert.ok(published.ok);
  assert.ok((await links.listLinks(true)).some((link) => link.id === created.id));
  const current = await links.getLink(created.id);
  assert.equal(current.name, 'Renamed library');
  assert.ok((await links.saveLinkFromForm(form({ name: current.name }), current, actor)).ok);
  assert.ok(!(await links.listLinks(true)).some((link) => link.id === created.id));
  assert.ok(await links.deleteLink(created.id, actor));
  assert.equal(await links.getLink(created.id), null);
  assert.equal(await links.deleteLink(created.id, actor), false);
  assert.deepEqual(entries(created.id).map((entry) => entry.action), ['link-create', 'link-update', 'link-publish', 'link-unpublish', 'link-delete']);
  assert.ok(entries(created.id).every((entry) => entry.actor_id === actor.id));
  assert.equal(entries(created.id).at(-1).target_label, 'Renamed library');
  assert.equal(await links.getLink('../invalid'), null);
});

test('unsafe URLs, unsupported types, invalid dates and excessive fields never write', async () => {
  const before = database.prepare('SELECT COUNT(*) AS count FROM community_links').get().count;
  const attacks = [
    { url: 'javascript:alert(1)' }, { url: 'data:text/html,test' }, { url: '//example.test' }, { url: 'https://user:password@example.test/' },
    { county: 'other' }, { category: 'business' }, { status: 'hidden' }, { checked_on: '2026-02-30' }, { checked_on: '2099-01-01' },
    { status: 'published', checked_on: '' }, { name: 'x' }, { name: 'x'.repeat(141) }, { community: 'x'.repeat(81) }, { description: 'x'.repeat(301) },
  ];
  for (const attack of attacks) {
    const result = await links.saveLinkFromForm(form(attack), null, actor);
    assert.equal(result.ok, false, JSON.stringify(attack));
    assert.ok(result.errors.length);
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM community_links').get().count, before);
  assert.deepEqual(links.readLinkValues(form({ url: 'http://example.test/', checked_on: '' })).errors, []);
  assert.deepEqual(links.readLinkValues(form({ checked_on: '2024-02-29' })).errors, []);
});

test('countywide comes first, communities are alphabetical and resource types have a useful order', () => {
  const fixture = (county, community, category, name) => ({ ...links.emptyLink, id: crypto.randomUUID(), county, community, category, name });
  const grouped = links.groupLinks([
    fixture('ottawa', 'Port Clinton', 'library', 'Library'), fixture('erie', 'Sandusky', 'library', 'Library'),
    fixture('erie', 'Sandusky', 'government', 'City'), fixture('erie', 'Huron', 'government', 'Huron'), fixture('erie', '', 'government', 'County'),
  ]);
  assert.deepEqual(grouped.map((group) => group.county), ['erie', 'ottawa']);
  assert.deepEqual(grouped[0].places.map((place) => place.community), ['', 'Huron', 'Sandusky']);
  assert.deepEqual(grouped[0].places[2].items.map((link) => link.category), ['government', 'library']);
  assert.deepEqual(links.groupLinks([]), []);
});

test('audit failure rolls back a content write in the same transaction', async () => {
  const before = (await links.listLinks()).length;
  await assert.rejects(links.saveLinkFromForm(form(), null, { id: 'missing-actor', name: 'Missing' }), /FOREIGN KEY/);
  assert.equal((await links.listLinks()).length, before);
});

test('deletion requires confirmation, accepts staff with directory access, and handles missing IDs', async () => {
  const created = await links.saveLinkFromForm(form(), null, actor);
  const post = async (fields) => POST({
    locals: { user: actor, staffRole: 'editor' },
    request: new Request('https://firelandscurrent.com/api/admin/links', { method: 'POST', headers: { origin: 'https://firelandscurrent.com' }, body: new URLSearchParams(fields) }),
  });
  const fields = { action: 'delete', id: created.id, confirm: 'DELETE' };
  assert.equal((await post({ ...fields, confirm: '' })).status, 400);
  assert.ok(await links.getLink(created.id));
  const removed = await post(fields);
  assert.equal(removed.status, 303);
  assert.equal(new URL(removed.headers.get('Location')).pathname, '/admin/links');
  assert.equal((await post(fields)).status, 404);
  assert.equal((await post({ ...fields, id: 'invalid!' })).status, 400);
});
