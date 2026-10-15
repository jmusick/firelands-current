import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--apply-local', '--verify-local', '--verify-http'].includes(mode) && process.argv.length === 3,
  'Use --apply-local, --verify-local or --verify-http. This utility has no production mode.');
const dir = editorialDirectory('2026-10-13');
const pack = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
globalThis.__editorialImportEnv = proxy.env;
const envModule = 'data:text/javascript,export const env=globalThis.__editorialImportEnv;';
function sourceModule(path, replacements) {
  let source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => `from ${JSON.stringify(replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const forumModule = sourceModule('src/lib/forum.ts', { 'cloudflare:workers': envModule });
const media = await import(sourceModule('src/lib/media.ts', { 'cloudflare:workers': envModule, './forum': forumModule }));
const db = proxy.env.DB;
const tables = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results])));
}
function insert(table, row) {
  const columns = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...Object.values(row));
}
function photoNote(photo) {
  const url = photo.source_url.replaceAll('(', '%28').replaceAll(')', '%29');
  return `*Photo: [${photo.credit.split(' / ')[0]}](${url}), [${photo.license}](${photo.license_url}). File photo.*`;
}
function thread(row, kind, now) {
  return { id: randomUUID(), author_id: 'newsroom', title: row.headline ?? row.title, body: row.summary,
    [kind + '_id']: row.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now };
}
try {
  if (mode === '--apply-local') {
    assert(!existsSync(dir + 'import.json') && !existsSync(dir + 'import-pending.json'), 'Import journal exists; inspect it before trying again.');
    const actor = await db.prepare('SELECT id, name FROM "user" WHERE email = ?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD', 'JD account not found');
    assert(await db.prepare('SELECT id FROM "user" WHERE id = ?').bind('newsroom').first(), 'Newsroom account not found');
    const before = await snapshot();
    save('before.json', before);
    for (const [table, entries] of [['news_articles', pack.articles], ['events', pack.events]]) {
      assert.equal(new Set(entries.map(entry => entry.slug)).size, entries.length);
      for (const entry of entries) {
        assert(/^[a-z0-9-]{1,120}$/.test(entry.slug));
        assert(!before[table].some(row => row.slug === entry.slug), `Duplicate slug: ${entry.slug}`);
      }
    }
    for (const article of pack.articles) assert(article.body.split('\n\n')[0].split(/\s+/).length <= 35, `Lede too long: ${article.slug}`);
    const statements = [];
    const imported = { target: 'local', imported_at: Date.now(), images: [], articles: [], events: [], threads: [] };
    const uploads = [];
    try {
      for (const photo of pack.images) {
        if (photo.existing_id) {
          const record = before.media.find(row => row.id === photo.existing_id);
          assert(record && record.credit === photo.credit && record.alt && !record.decorative, 'Existing photo credit or alt text mismatch');
          const object = await proxy.env.MEDIA.get(record.object_key);
          assert(object, 'Existing image missing from local R2');
          imported.images.push({ ...photo, record, reused: true, stored_sha256: hash(new Uint8Array(await object.arrayBuffer())) });
          continue;
        }
        const bytes = readFileSync(dir + 'images/' + photo.filename);
        const checked = await media.checkUpload(new File([bytes], photo.filename, { type: 'image/jpeg' }));
        assert.notEqual(typeof checked, 'string', `${photo.filename}: ${checked}`);
        const details = { alt: photo.alt, decorative: false, caption: photo.caption, credit: photo.credit,
          source: `Source: ${photo.source_url} | License: ${photo.license}, ${photo.license_url} | Verified Oct. 13, 2026; evidence and original download in editorial/2026-10-13. Historical file photo, not the current work or event. Metadata removed by checkUpload; downloaded pixels retained.` };
        assert.deepEqual(media.validateDetails(details), []);
        const { record, statement } = await media.storeMedia(checked, photo.filename, details, actor.id);
        uploads.push(record);
        statements.push(statement, media.mediaAudit(actor, record, 'media-upload', `${record.width}×${record.height}; public-domain file photo for Oct. 13 local review`));
        imported.images.push({ ...photo, record, reused: false, original_sha256: hash(bytes), stored_sha256: hash(checked.bytes) });
      }
      const imageFor = key => imported.images.find(image => image.key === key);
      for (const article of pack.articles) {
        const photo = imageFor(article.image);
        assert(!article.image || photo, 'Selected image missing');
        const now = Date.now();
        const row = { id: randomUUID(), slug: article.slug, headline: article.headline, summary: article.summary,
          body: article.body + (photo ? '\n\n' + photoNote(photo) + (article.image === 'sandusky' ? ' This downtown file photo does not show the parade or establish its route.' : '') : ''), section: article.section, community: article.community,
          byline: actor.name, author_id: actor.id, lead_media_id: photo?.record.id ?? null, featured: 0,
          status: 'published', published_at: now, created_at: now, updated_at: now };
        const discussion = thread(row, 'article', now);
        statements.push(insert('news_articles', row), insert('forum_threads', discussion));
        // Local publication is for editorial review; suppress the automatic social outbox.
        statements.push(db.prepare('UPDATE facebook_posts SET status = ?, updated_at = ? WHERE article_id = ? AND status = ? AND attempts = 0')
          .bind('review', now, row.id, 'pending'));
        imported.articles.push(row);
        imported.threads.push(discussion);
      }
      for (const event of pack.events) {
        const { image, ...fields } = event;
        const photo = image && imageFor(image);
        const now = Date.now();
        const row = { id: randomUUID(), performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '',
          ...fields, description: fields.description + (photo ? '\n\n' + photoNote(photo) : ''),
          image_media_id: photo ? photo.record.id : null, status: 'published', created_at: now, updated_at: now };
        const discussion = thread(row, 'event', now);
        statements.push(insert('events', row), insert('forum_threads', discussion));
        imported.events.push(row);
        imported.threads.push(discussion);
      }
      save('import-pending.json', imported);
      const results = await media.batchWithUploads(uploads, statements);
      assert(results.every(result => result.success && result.meta.changes >= 1), 'Unexpected import batch result');
      save('import.json', imported);
    } catch (error) {
      await media.discardUnsavedMedia(uploads);
      throw error;
    }
  }
  const imported = JSON.parse(readFileSync(dir + 'import.json', 'utf8'));
  const before = JSON.parse(readFileSync(dir + 'before.json', 'utf8'));
  const after = await snapshot();
  const newImages = imported.images.filter(image => !image.reused);
  const additions = { news_articles: imported.articles.length, events: imported.events.length, forum_threads: imported.threads.length,
    media: newImages.length, facebook_posts: imported.articles.length, admin_audit_log: newImages.length };
  for (const table of tables) {
    assert.equal(after[table].length, before[table].length + additions[table], `${table} count changed unexpectedly`);
    for (const row of before[table]) {
      assert.deepEqual(after[table].find(current => (current.id ?? current.article_id) === (row.id ?? row.article_id)), row, `Existing ${table} row changed`);
    }
  }
  for (const [table, rows] of [['news_articles', imported.articles], ['events', imported.events], ['forum_threads', imported.threads]]) {
    for (const row of rows) {
      const actual = after[table].find(current => current.id === row.id);
      for (const [key, value] of Object.entries(row)) assert.equal(actual[key], value, `${table}.${key}`);
    }
  }
  for (const image of imported.images) {
    assert.deepEqual(after.media.find(row => row.id === image.record.id), image.record);
    const object = await proxy.env.MEDIA.get(image.record.object_key);
    assert(object && object.size === image.record.bytes);
    assert.equal(hash(new Uint8Array(await object.arrayBuffer())), image.stored_sha256);
    if (!image.reused) {
      assert.equal(hash(readFileSync(dir + 'images/' + image.filename)), image.original_sha256);
      assert(after.admin_audit_log.some(row => row.target_media_id === image.record.id && row.action === 'media-upload'));
    }
  }
  for (const row of imported.articles) {
    const ledger = after.facebook_posts.find(entry => entry.article_id === row.id);
    assert.equal(ledger.status, 'review');
    assert.equal(ledger.attempts, 0);
    assert.equal(ledger.post_id, null);
  }
  const report = { checked_at: new Date().toISOString(), target: 'local', counts: Object.fromEntries(tables.map(table => [table, { before: before[table].length, after: after[table].length }])),
    existing_content_rows_unchanged: true, author: 'JD', discussions: imported.threads.length, media_checksums_valid: true, facebook_status: 'review', http: [] };
  if (mode === '--verify-http') {
    for (const [kind, entries] of [['news', imported.articles], ['events', imported.events]]) {
      for (const entry of entries) {
        const url = `http://127.0.0.1:4321/${kind}/${entry.slug}`;
        const response = await fetch(url);
        assert.equal(response.status, 200, url);
        const html = await response.text();
        const title = (entry.headline ?? entry.title).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        assert(html.includes(title), `Title missing: ${url}`);
        const discussion = imported.threads.find(row => row.article_id === entry.id || row.event_id === entry.id);
        assert(html.includes(`/talk/${discussion.id}`));
        if (kind === 'news') {
          assert(html.includes(`/profile/${entry.author_id}`));
          const photo = imported.images.find(image => image.record.id === entry.lead_media_id);
          if (photo) {
            assert(html.includes(`/media/${photo.record.object_key}`));
            assert(html.includes(photo.license_url));
          }
        }
        report.http.push({ url, status: response.status });
      }
    }
    for (const image of imported.images) {
      const url = `http://127.0.0.1:4321/media/${image.record.object_key}`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), image.stored_sha256);
      report.http.push({ url, status: response.status });
    }
  }
  save('evidence/image-manifest.json', imported.images);
  save(mode === '--verify-http' ? 'evidence/http-verification.json' : 'evidence/local-verification.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await proxy.dispose();
}
