import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--apply-local', '--verify-local', '--verify-http'].includes(mode));
const dir = editorialDirectory('2026-10-15');
const research = JSON.parse(readFileSync(dir + 'research.json', 'utf8'));
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
const audit = await import(sourceModule('src/lib/audit.ts', { 'cloudflare:workers': envModule }));
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
    assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect the existing local import journal before retrying.');
    assert.equal(research.date, '2026-10-15');
    assert.equal(research.stories.length, 4);
    assert.equal(research.events.length, 4);
    assert(research.stories.every(row => row.status === 'ready'));
    assert(research.events.every(row => row.status === 'ready'));
    const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD');
    assert(await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first());
    const before = await snapshot();
    save('local-before.json', before);
    for (const [table, entries] of [['news_articles', research.stories], ['events', research.events]]) for (const entry of entries) {
      assert(/^[a-z0-9-]{1,120}$/.test(entry.slug));
      assert(!before[table].some(row => row.slug === entry.slug), 'Duplicate slug: ' + entry.slug);
    }
    const vendor = research.updates.find(update => update.slug === 'perkins-night-of-lights-2026');
    assert.equal(vendor?.status, 'ready');
    const oldEvent = before.events.find(row => row.slug === vendor.slug);
    assert(oldEvent && !oldEvent.description.includes(vendor.proposed_copy));
    const journal = { actor, articles: [], events: [], threads: [], images: [], updates: [] };
    const statements = [], uploads = [];
    try {
      for (const story of research.stories) {
        const image = story.image;
        if (image.status !== 'cleared') continue;
        assert.equal(image.placement, 'lead');
        const original = readFileSync(dir + 'images/' + image.file);
        const checked = await media.checkUpload(new File([original], image.file, { type: 'image/jpeg' }));
        assert.notEqual(typeof checked, 'string', 'Image validation failed: ' + checked);
        const details = { alt: image.alt, decorative: false, caption: image.caption, credit: image.credit,
          source: `Source: ${image.source_url} | License: ${image.license}, ${image.license_url} | Verified Oct. 15, 2026; evidence and original downloaded Commons crop in editorial/2026-10-15. Photographed Aug. 21, 2021; Commons crop uploaded in 2023. No further visual edits. Metadata removed by checkUpload.` };
        assert.deepEqual(media.validateDetails(details), []);
        const { record, statement } = await media.storeMedia(checked, image.file, details, actor.id);
        uploads.push(record);
        statements.push(statement, media.mediaAudit(actor, record, 'media-upload', 'Licensed Terra State campus file photo for local editorial review; caption and alt verified.'));
        journal.images.push({ story: story.key, ...image, record, original_sha256: hash(original), stored_sha256: hash(checked.bytes) });
      }
      assert.equal(journal.images.length, 1);
      for (const story of research.stories) {
        const now = Date.now();
        const photo = journal.images.find(image => image.story === story.key);
        const row = { id: randomUUID(), slug: story.slug, headline: story.headline, summary: story.summary,
          body: story.body, section: story.section, community: story.community, byline: actor.name,
          author_id: actor.id, lead_media_id: photo?.record.id ?? null, featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now };
        const discussion = thread(row, 'article', now);
        statements.push(insert('news_articles', row), insert('forum_threads', discussion),
          audit.auditResource(actor, { type: 'story', id: row.id, label: row.headline }, 'story-create', `/news/${row.slug}; published`),
          audit.auditResource(actor, { type: 'story', id: row.id, label: row.headline }, 'story-publish'),
          db.prepare("UPDATE facebook_posts SET status='review',updated_at=? WHERE article_id=? AND status='pending' AND attempts=0").bind(now, row.id));
        journal.articles.push(row); journal.threads.push(discussion);
      }
      for (const event of research.events) {
        const now = Date.now();
        const row = { id: randomUUID(), slug: event.slug, title: event.title, summary: event.summary,
          description: `${event.description}\n\n[Organizer details](${event.source_url})`, category: event.category,
          starts_on: event.starts_on, start_time: event.start_time, ends_on: event.ends_on, end_time: event.end_time,
          hours_note: event.hours_note, venue: event.venue, address: event.address, community: event.community,
          organizer: event.organizer, organizer_url: event.organizer_url, cost: event.cost, link: event.source_url,
          performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '',
          image_media_id: null, status: 'published', created_at: now, updated_at: now };
        const discussion = thread(row, 'event', now);
        statements.push(insert('events', row), insert('forum_threads', discussion),
          audit.auditResource(actor, { type: 'event', id: row.id, label: row.title }, 'event-create', `/events/${row.slug}; published`),
          audit.auditResource(actor, { type: 'event', id: row.id, label: row.title }, 'event-publish'));
        journal.events.push(row); journal.threads.push(discussion);
      }
      const now = Date.now();
      const updatedEvent = { ...oldEvent, description: oldEvent.description + '\n\n' + vendor.proposed_copy, updated_at: now };
      statements.push(db.prepare('UPDATE events SET description=?,updated_at=? WHERE id=? AND updated_at=?')
        .bind(updatedEvent.description, now, oldEvent.id, oldEvent.updated_at),
        audit.auditRecord(actor, 'event', oldEvent.id, 'event-update', 'Changed: details'));
      journal.updates.push({ table: 'events', before: oldEvent, after: updatedEvent });
      save('local-import-pending.json', journal);
      const results = await media.batchWithUploads(uploads, statements);
      save('evidence/local-import-batch.json', results);
      assert(results.every(result => result.success && result.meta.changes >= 1));
      save('local-import.json', journal);
    } catch (error) { await media.discardUnsavedMedia(uploads); throw error; }
  }

  const journal = JSON.parse(readFileSync(dir + 'local-import.json', 'utf8'));
  const before = JSON.parse(readFileSync(dir + 'local-before.json', 'utf8'));
  const after = await snapshot();
  const additions = { news_articles: 4, events: 4, forum_threads: 8, media: 1, facebook_posts: 4, admin_audit_log: 18 };
  for (const table of tables) {
    assert.equal(after[table].length, before[table].length + additions[table], table);
    for (const row of before[table]) {
      const update = journal.updates.find(update => update.table === table && update.before.id === row.id);
      assert.deepEqual(after[table].find(current => (current.id ?? current.article_id) === (row.id ?? row.article_id)), update?.after ?? row, 'Unexpected change: ' + table);
    }
  }
  for (const [table, entries] of [['news_articles', journal.articles], ['events', journal.events], ['forum_threads', journal.threads]]) for (const row of entries) {
    const actual = after[table].find(current => current.id === row.id);
    for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, table + '.' + field);
  }
  for (const article of journal.articles) {
    const ledger = after.facebook_posts.find(row => row.article_id === article.id);
    assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id);
    assert.equal(article.featured, 0);
  }
  for (const image of journal.images) {
    assert.deepEqual(after.media.find(row => row.id === image.record.id), image.record);
    const object = await proxy.env.MEDIA.get(image.record.object_key);
    assert(object && hash(new Uint8Array(await object.arrayBuffer())) === image.stored_sha256);
  }
  const report = { checked_at: new Date().toISOString(), scope: 'Local database and local R2 emulation only',
    counts: Object.fromEntries(tables.map(table => [table, { before: before[table].length, after: after[table].length }])),
    existing_changes: ['Night of Lights description and updated_at only'], held_church_unchanged: true,
    facebook: 'review, zero attempts', new_stories_featured: false, http: [] };
  if (mode === '--verify-http') {
    for (const [kind, rows] of [['news', journal.articles], ['events', [...journal.events, journal.updates[0].after]]]) for (const row of rows) {
      const url = `http://127.0.0.1:4321/${kind}/${row.slug}`;
      const response = await fetch(url); assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes((row.headline ?? row.title).replaceAll('&', '&amp;')), url);
      if (kind === 'news') assert(html.includes('/profile/' + row.author_id));
      report.http.push({ url, status: response.status });
    }
    for (const image of journal.images) {
      const url = 'http://127.0.0.1:4321/media/' + image.record.object_key;
      const response = await fetch(url); assert.equal(response.status, 200);
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), image.stored_sha256);
      report.http.push({ url, status: response.status, checksum_verified: true });
    }
  }
  save(mode === '--verify-http' ? 'evidence/local-http-verification.json' : 'evidence/local-import-verification.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally { await proxy.dispose(); }
