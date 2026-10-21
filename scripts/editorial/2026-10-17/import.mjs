import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--apply-local', '--verify-local', '--verify-http', '--add-photo-credit'].includes(mode));
const dir = editorialDirectory('2026-10-17');
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
  if (mode === '--add-photo-credit') {
    assert(!existsSync(dir + 'photo-credit-revision.json'), 'Attribution revision already recorded.');
    const journal = JSON.parse(readFileSync(dir + 'local-import.json', 'utf8'));
    const photo = journal.images[0];
    const row = journal.articles.find(article => article.lead_media_id === photo.record.id);
    const before = await db.prepare('SELECT * FROM news_articles WHERE id=?').bind(row.id).first();
    assert.equal(before.body, row.body);
    assert(!row.body.includes(photo.license_url), 'Attribution links already present.');
    const body = row.body + `\n\n*Photo credit: [${photo.credit}](${photo.source_url}). [${photo.license}](${photo.license_url}). Displayed with a layout crop; original image retained.*`;
    const now = Date.now();
    const results = await db.batch([
      db.prepare('UPDATE news_articles SET body=?,updated_at=? WHERE id=? AND body=?').bind(body, now, row.id, row.body),
      audit.auditResource(journal.actor, { type: 'story', id: row.id, label: row.headline }, 'story-update', 'Changed: photo attribution links'),
    ]);
    assert(results.every(result => result.success && result.meta.changes === 1));
    Object.assign(row, { body, updated_at: now });
    save('photo-credit-revision.json', { before, after: row, results });
    save('local-import.json', journal);
  }
  if (mode === '--apply-local') {
    assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect the existing local import journal before retrying.');
    assert.equal(research.date, '2026-10-17');
    assert.equal(research.stories.length, 4);
    assert.equal(research.events.length, 6);
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
    assert.equal(research.updates.length, 2);
    const updates = research.updates.map(update => {
      assert.equal(update.status, 'ready');
      const table = update.slug === 'sandusky-witches-walk-2026' ? 'events' : 'news_articles';
      const old = before[table].find(row => row.slug === update.slug);
      assert(old && !old[table === 'events' ? 'description' : 'body'].includes(update.proposed_copy));
      let fields;
      if (table === 'events') fields = { description: old.description + '\n\n' + update.proposed_copy };
      else {
        assert.equal(old.slug, 'downtown-sandusky-halloween-capital-witches-walk-2026');
        const paragraphs = old.body.replaceAll('\r\n', '\n').split('\n\n');
        assert(paragraphs[0].includes('150 light poles') && paragraphs[1].includes('big reveal'));
        let previous = paragraphs.slice(2).join('\n\n');
        const ticket = 'A ticket is required to march in the parade, join the dance and enter the raffle, according to the event website. VIP tickets cost $45 plus a service fee and cover events all month. Organizers say prices go up on event night.';
        assert(previous.includes(ticket));
        previous = previous.replace(ticket, 'In the event announcement previously reported Oct. 1, organizers said a ticket was required to march in the parade, join the dance and enter the raffle. That announcement listed VIP tickets at $45 plus a service fee, with higher prices on event night. Current ticket prices and availability have not been reverified.');
        fields = { body: '*Updated Oct. 17, 2026, with completed installations and temporary transit changes.*\n\n' + update.proposed_copy + '\n\n' + previous };
      }
      return { table, before: old, after: { ...old, ...fields, updated_at: Date.now() } };
    });
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
          source: `Source: ${image.source_url} | License: ${image.license}, ${image.license_url} | Verified Oct. 17, 2026; source and license evidence in editorial/2026-10-17. Photographed Sept. 7, 2026 by Fergo22. Original JPEG, no visual edits. Metadata removed by checkUpload. Preserve CC BY-SA 4.0 attribution; disclose further crops and license adaptations alike.` };
        assert.deepEqual(media.validateDetails(details), []);
        const { record, statement } = await media.storeMedia(checked, image.file, details, actor.id);
        uploads.push(record);
        statements.push(statement, media.mediaAudit(actor, record, 'media-upload', 'Licensed Sandusky High School file photo for local editorial review; caption and alt verified.'));
        journal.images.push({ story: story.key, ...image, record, original_sha256: hash(original), stored_sha256: hash(checked.bytes) });
      }
      assert.equal(journal.images.length, 1);
      for (const story of research.stories) {
        const now = Date.now();
        const photo = journal.images.find(image => image.story === story.key);
        const row = { id: randomUUID(), slug: story.slug, headline: story.headline, summary: story.summary,
          body: story.body + (photo ? `\n\n*Photo credit: [${photo.credit}](${photo.source_url}). [${photo.license}](${photo.license_url}). Displayed with a layout crop; original image retained.*` : ''), section: story.section, community: story.community, byline: actor.name,
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
      for (const update of updates) {
        const field = update.table === 'events' ? 'description' : 'body';
        const type = update.table === 'events' ? 'event' : 'story';
        statements.push(db.prepare(`UPDATE ${update.table} SET ${field}=?,updated_at=? WHERE id=? AND updated_at=?`)
          .bind(update.after[field], update.after.updated_at, update.before.id, update.before.updated_at),
          audit.auditRecord(actor, type, update.before.id, type + '-update', 'Changed: ' + (type === 'event' ? 'details' : 'story text')));
        journal.updates.push(update);
      }
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
  const additions = { news_articles: 4, events: 6, forum_threads: 10, media: 1, facebook_posts: 4, admin_audit_log: 23 + Number(existsSync(dir + 'photo-credit-revision.json')) };
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
    existing_changes: ['Halloween makeover story body and updated_at', 'Witches Walk event description and updated_at'], held_church_unchanged: true,
    facebook: 'review, zero attempts', new_stories_featured: false, http: [] };
  if (mode === '--verify-http') {
    for (const [kind, rows] of [['news', [...journal.articles, ...journal.updates.filter(u => u.table === 'news_articles').map(u => u.after)]], ['events', [...journal.events, ...journal.updates.filter(u => u.table === 'events').map(u => u.after)]]]) for (const row of rows) {
      const url = `http://127.0.0.1:4321/${kind}/${row.slug}`;
      const response = await fetch(url); assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes((row.headline ?? row.title).replaceAll('&', '&amp;')), url);
      if (kind === 'news') assert(html.includes('/profile/' + row.author_id));
      const photo = journal.images.find(image => image.record.id === row.lead_media_id);
      if (photo) assert(html.includes(photo.source_url) && html.includes(photo.license_url), 'Public photo attribution: ' + url);
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
