import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Isolated regressions for the alt text decision: validation, the migration's treatment of existing
// rows, storage, and the "needs alt text" listing. Uses an in-memory database and a fake R2 bucket.
const database = new DatabaseSync(':memory:');
const migrations = readdirSync(new URL('../migrations/', import.meta.url)).sort();
const decorativeMigration = migrations.find((name) => name.startsWith('0023'));
assert(decorativeMigration, 'migration 0023 is missing');
for (const name of migrations) {
  if (name !== decorativeMigration) database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}

// A row from before the migration: no alt text, and nobody has decided anything about it.
database.exec(`INSERT INTO media (id, object_key, content_type, width, height, bytes, filename, alt, caption, credit, source, created_at, updated_at)
  VALUES ('legacy-empty', 'library/legacy-empty.jpg', 'image/jpeg', 10, 10, 1, 'a.jpg', '', '', 'Photo by Test', '', 1, 1),
         ('legacy-alt', 'library/legacy-alt.jpg', 'image/jpeg', 10, 10, 1, 'b.jpg', 'Boats in the harbor', '', 'Photo by Test', '', 2, 2)`);
database.exec(readFileSync(new URL(`../migrations/${decorativeMigration}`, import.meta.url), 'utf8'));

const stored = new Map();
globalThis.__altEnv = {
  DB: { prepare(sql) {
    const statement = database.prepare(sql);
    let values = [];
    const query = {
      bind(...args) { values = args; return query; },
      async all() { return { results: statement.all(...values) }; },
      async first() { return statement.get(...values) ?? null; },
      async run() { return statement.run(...values); },
    };
    return query;
  }, async batch(statements) { for (const s of statements) await s.run(); } },
  MEDIA: { async put(key, bytes) { stored.set(key, bytes); } },
};
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__altEnv;')}`;
async function load(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_m, s) => `from ${JSON.stringify(s === 'cloudflare:workers' ? envModule : replacements[s] ?? import.meta.resolve(s))}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const forumStub = `data:text/javascript,${encodeURIComponent('export const cleanText = (v) => typeof v === "string" ? v.trim() : "";')}`;
const media = await load('src/lib/media.ts', { './forum': forumStub });
const form = (fields) => Object.entries(fields).reduce((f, [k, v]) => (f.set(k, v), f), new FormData());
const details = (fields) => media.detailsFrom(form({ credit: 'Photo by Test', ...fields }));

test('an image needs alt text or an explicit decorative decision', () => {
  assert.deepEqual(media.validateDetails(details({ alt: 'Two sailboats leave Sandusky Bay at dawn.' })), []);
  assert.deepEqual(media.validateDetails(details({ decorative: 'on' })), []);
  assert.equal(media.validateDetails(details({})).length, 1, 'empty alt without the decorative choice is refused');
  assert.match(media.validateDetails(details({}))[0], /decorative/);
  assert.equal(media.validateDetails(details({ alt: '   ' })).length, 1, 'whitespace is empty');
});

test('decorative and described are mutually exclusive', () => {
  assert.equal(media.validateDetails(details({ alt: 'Boats', decorative: 'on' })).length, 1);
});

test('placeholder and file-name alt text does not count as a description', () => {
  for (const alt of ['image', 'Photo', 'picture.', 'IMG', 'dscn1234.jpg', 'logo.PNG']) {
    assert.equal(media.validateDetails(details({ alt })).length, 1, alt);
  }
  assert.deepEqual(media.validateDetails(details({ alt: 'Photo of a dredge at work in Sandusky Bay' })), []);
});

test('the decorative field accepts only checkbox-style values', () => {
  assert.equal(details({ decorative: 'on' }).decorative, true);
  assert.equal(details({ decorative: '1' }).decorative, true);
  assert.equal(details({ decorative: 'no' }).decorative, false);
  assert.equal(details({}).decorative, false);
});

test('migration leaves existing rows undecided and the filter finds only them', async () => {
  const rows = database.prepare('SELECT id, decorative FROM media ORDER BY id').all();
  assert.deepEqual(rows.map((r) => r.decorative), [0, 0]);
  const needing = await media.listMedia('', 0, true);
  assert.deepEqual(needing.map((m) => m.id), ['legacy-empty']);
  assert.equal(await media.countNeedingAlt(), 1);
  assert.equal(media.needsAltDecision(needing[0]), true);
  assert.equal((await media.listMedia('', 0)).length, 2);
});

test('the decorative column only holds 0 or 1', () => {
  assert.throws(() => database.exec(`UPDATE media SET decorative = 2 WHERE id = 'legacy-alt'`));
});

test('stored decisions round-trip and leave the needs-alt list', async () => {
  const png = new Uint8Array(40); png.set([0x89, 0x50, 0x4e, 0x47]);
  const image = { bytes: png, type: 'image/png', ext: 'png', width: 20, height: 20 };
  const decorative = await media.storeMedia(image, 'rule.png', { alt: '', decorative: true, caption: '', credit: 'Test', source: '' }, null);
  const described = await media.storeMedia(image, 'boats.png', { alt: 'Boats', decorative: false, caption: '', credit: 'Test', source: '' }, null);
  await globalThis.__altEnv.DB.batch([decorative.statement, described.statement]);
  const row = (id) => database.prepare('SELECT alt, decorative FROM media WHERE id = ?').get(id);
  assert.deepEqual({ ...row(decorative.record.id) }, { alt: '', decorative: 1 });
  assert.deepEqual({ ...row(described.record.id) }, { alt: 'Boats', decorative: 0 });
  assert.equal(media.toItem(decorative.record).decorative, true);
  assert.equal(media.toItem(described.record).decorative, false);
  assert.deepEqual((await media.listMedia('', 0, true)).map((m) => m.id), ['legacy-empty']);
});
