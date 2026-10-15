import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--apply-local', '--reconcile-local', '--verify-local', '--verify-http'].includes(mode));
const dir = editorialDirectory('2026-10-14');
const pack = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
globalThis.__editorialImportEnv = proxy.env;
const envModule = 'data:text/javascript,export const env=globalThis.__editorialImportEnv;';
function sourceModule(path, replacements) {
  let source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
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
  return db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
}
function thread(row, kind, now) {
  return { id: randomUUID(), author_id: 'newsroom', title: row.headline ?? row.title, body: row.summary,
    [kind + '_id']: row.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now };
}
try {
  if (mode === '--apply-local') {
    assert(!existsSync(dir + 'import.json') && !existsSync(dir + 'import-pending.json'), 'Inspect existing import journal before retrying.');
    const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD');
    assert(await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first());
    const before = await snapshot();
    save('before.json', before);
    for (const [table, entries] of [['news_articles', pack.articles], ['events', pack.events]]) for (const entry of entries) {
      assert(/^[a-z0-9-]{1,120}$/.test(entry.slug));
      assert(!before[table].some(row => row.slug === entry.slug), 'Duplicate slug: ' + entry.slug);
    }
    const journal = { actor, articles: [], events: [], threads: [], images: [], updates: [] };
    const statements = [], uploads = [];
    try {
      for (const photo of pack.images) {
        const bytes = readFileSync(dir + 'images/' + photo.filename);
        const checked = await media.checkUpload(new File([bytes], photo.filename, { type: 'image/jpeg' }));
        assert.notEqual(typeof checked, 'string', 'Image validation failed: ' + checked);
        const details = { alt: photo.alt, decorative: false, caption: photo.caption, credit: photo.credit,
          source: `Source: ${photo.source_url} | License: ${photo.license}, ${photo.license_url} | Verified Oct. 14, 2026; source evidence and Commons 1280-pixel derivative in editorial/2026-10-14. Historical 2012 New York file photo. Metadata removed by checkUpload.` };
        assert.deepEqual(media.validateDetails(details), []);
        const { record, statement } = await media.storeMedia(checked, photo.filename, details, actor.id);
        uploads.push(record);
        statements.push(statement, media.mediaAudit(actor, record, 'media-upload', 'Public-domain Tim McGraw file photo for Oct. 14 story; historical caption and alt text verified.'));
        journal.images.push({ ...photo, record, stored_sha256: hash(checked.bytes), original_sha256: hash(bytes) });
      }
      for (const article of pack.articles) {
        const now = Date.now();
        const photo = journal.images.find(photo => photo.key === article.image);
        const photoNote = photo ? `\n\n*File photo: [${photo.credit}](${photo.source_url.replaceAll('(', '%28').replaceAll(')', '%29')}), [${photo.license}](${photo.license_url}). Photographed May 28, 2012, in New York; not The Bash or its Norwalk venue.*` : '';
        const row = { id: randomUUID(), slug: article.slug, headline: article.headline, summary: article.summary,
          body: article.body + photoNote, section: article.section, community: article.community, byline: actor.name,
          author_id: actor.id, lead_media_id: photo?.record.id ?? null, featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now };
        const discussion = thread(row, 'article', now);
        statements.push(insert('news_articles', row), insert('forum_threads', discussion),
          db.prepare("UPDATE facebook_posts SET status='review',updated_at=? WHERE article_id=? AND status='pending' AND attempts=0").bind(now, row.id));
        journal.articles.push(row); journal.threads.push(discussion);
      }
      for (const event of pack.events) {
        const { image, ...fields } = event;
        const now = Date.now();
        const row = { id: randomUUID(), ...fields, performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '', image_media_id: null, status: 'published', created_at: now, updated_at: now };
        const discussion = thread(row, 'event', now);
        statements.push(insert('events', row), insert('forum_threads', discussion));
        journal.events.push(row); journal.threads.push(discussion);
      }
      const oldArticle = before.news_articles.find(row => row.slug === pack.parade.slug);
      const oldEvent = before.events.find(row => row.slug === pack.parade.slug);
      assert(oldArticle && oldEvent);
      const note = oldArticle.body.slice(oldArticle.body.indexOf('\n\n*Photo:'));
      assert(note.startsWith('\n\n*Photo:'));
      const now = Date.now();
      const article = { ...oldArticle, headline: pack.parade.headline, summary: pack.parade.summary, body: pack.parade.body + note, updated_at: now };
      const event = { ...oldEvent, summary: pack.parade.summary, description: pack.parade.event_description, hours_note: 'District calendar window: 5:30–8 p.m.; procession duration unannounced. Camp Street closure: 5–7 p.m.', updated_at: now };
      for (const [table, previous, updated] of [['news_articles', oldArticle, article], ['events', oldEvent, event]]) {
        const fields = Object.keys(updated).filter(field => updated[field] !== previous[field]);
        statements.push(db.prepare(`UPDATE ${table} SET ${fields.map(field => field + '=?').join(',')} WHERE id=? AND updated_at=?`).bind(...fields.map(field => updated[field]), previous.id, previous.updated_at));
        journal.updates.push({ table, before: previous, after: updated });
        const oldThread = before.forum_threads.find(row => row[table === 'events' ? 'event_id' : 'article_id'] === previous.id);
        assert(oldThread);
        const updatedThread = { ...oldThread, title: updated.headline ?? updated.title, body: updated.summary, updated_at: now };
        statements.push(db.prepare('UPDATE forum_threads SET title=?,body=?,updated_at=? WHERE id=? AND updated_at=?').bind(updatedThread.title, updatedThread.body, now, oldThread.id, oldThread.updated_at));
        journal.updates.push({ table: 'forum_threads', before: oldThread, after: updatedThread });
      }
      save('import-pending.json', journal);
      const result = await media.batchWithUploads(uploads, statements);
      save('evidence/local-batch.json', result);
      assert(result.every(result => result.success && result.meta.changes >= 1));
      save('import.json', journal);
    } catch (error) { await media.discardUnsavedMedia(uploads); throw error; }
  }
  const journal = JSON.parse(readFileSync(dir + (mode === '--reconcile-local' ? 'import-pending.json' : 'import.json'), 'utf8'));
  const before = JSON.parse(readFileSync(dir + 'before.json', 'utf8'));
  const after = await snapshot();
  const additions = { news_articles: 3, events: 5, forum_threads: 8, media: 1, facebook_posts: 3, admin_audit_log: 1 };
  for (const table of tables) {
    assert.equal(after[table].length, before[table].length + additions[table], table);
    for (const row of before[table]) {
      const update = journal.updates.find(update => update.table === table && update.before.id === row.id);
      assert.deepEqual(after[table].find(current => (current.id ?? current.article_id) === (row.id ?? row.article_id)), update?.after ?? row, 'Existing row changed unexpectedly: ' + table);
    }
  }
  for (const [table, entries] of [['news_articles', journal.articles], ['events', journal.events], ['forum_threads', journal.threads]]) for (const row of entries) {
    const actual = after[table].find(current => current.id === row.id);
    for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, table + '.' + field);
  }
  for (const photo of journal.images) {
    assert.deepEqual(after.media.find(row => row.id === photo.record.id), photo.record);
    const object = await proxy.env.MEDIA.get(photo.record.object_key);
    assert(object && hash(new Uint8Array(await object.arrayBuffer())) === photo.stored_sha256);
    assert(after.admin_audit_log.some(row => row.target_media_id === photo.record.id && row.action === 'media-upload'));
  }
  for (const article of journal.articles) {
    const ledger = after.facebook_posts.find(row => row.article_id === article.id);
    assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id);
  }
  const report = { checked_at: new Date().toISOString(), counts: Object.fromEntries(tables.map(table => [table, { before: before[table].length, after: after[table].length }])), only_parade_rows_updated: true, facebook: 'review', http: [] };
  if (mode === '--verify-http') {
    const rows = [['news', journal.articles], ['events', journal.events], ['news', [journal.updates.find(update => update.table === 'news_articles').after]], ['events', [journal.updates.find(update => update.table === 'events').after]]];
    for (const [kind, entries] of rows) for (const row of entries) {
      const url = 'http://127.0.0.1:4321/' + kind + '/' + row.slug;
      const response = await fetch(url); assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes((row.headline ?? row.title).replaceAll('&', '&amp;')));
      if (kind === 'news') assert(html.includes('/profile/' + row.author_id));
      report.http.push({ url, status: response.status });
    }
    for (const photo of journal.images) {
      const url = 'http://127.0.0.1:4321/media/' + photo.record.object_key;
      const response = await fetch(url); assert.equal(response.status, 200);
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), photo.stored_sha256);
      report.http.push({ url, status: response.status, checksum_verified: true });
    }
  }
  save(mode === '--verify-http' ? 'evidence/http-verification.json' : 'evidence/local-verification.json', report);
  save('evidence/image-manifest.json', journal.images);
  if (mode === '--reconcile-local') save('import.json', journal);
  console.log(JSON.stringify(report, null, 2));
} finally { await proxy.dispose(); }
