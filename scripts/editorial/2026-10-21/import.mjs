import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--apply-local', '--verify-local', '--verify-http'].includes(mode) && process.argv.length === 3);
const dir = editorialDirectory('2026-10-21');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const research = read('research.json');
const researchHash = hash(readFileSync(dir + 'research.json'));
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
const db = proxy.env.DB;
globalThis.__editorialImportEnv = proxy.env;
const envModule = 'data:text/javascript,export const env=globalThis.__editorialImportEnv;';
const auditSource = ts.transpileModule(readFileSync('src/lib/audit.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText.replace("from 'cloudflare:workers'", `from ${JSON.stringify(envModule)}`);
const audit = await import(`data:text/javascript;base64,${Buffer.from(auditSource).toString('base64')}`);
const tables = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
const additions = { news_articles: 4, events: 6, forum_threads: 10, media: 0, facebook_posts: 4, admin_audit_log: 20 };
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results])));
}
function insert(table, row) {
  return db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
}
function discussion(row, kind, now) {
  return { id: randomUUID(), author_id: 'newsroom', title: row.headline ?? row.title, body: row.summary,
    [kind + '_id']: row.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now };
}

try {
  assert.equal(proxy.env.FACEBOOK_AUTO_POST_ENABLED, 'false', 'Local Facebook delivery must remain disabled');
  if (mode === '--apply-local') {
    assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect existing journal before retrying');
    assert.equal(research.date, '2026-10-21');
    assert.equal(research.stories.length, 4); assert.equal(research.events.length, 6); assert.equal(research.updates.length, 0);
    assert([...research.stories, ...research.events].every(row => row.status === 'ready'));
    assert(research.stories.every(row => !row.body.includes('[NEED:')));
    const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD', 'JD author account is required');
    assert(await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first(), 'Discussion author is required');
    const before = await snapshot();
    for (const [table, entries] of [['news_articles', research.stories], ['events', research.events]]) {
      const slugs = new Set(before[table].map(row => row.slug));
      for (const entry of entries) {
        assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) && entry.slug.length <= 120);
        assert(!slugs.has(entry.slug), 'Duplicate slug: ' + entry.slug); slugs.add(entry.slug);
      }
    }
    const images = [];
    for (const story of research.stories) {
      if (story.image.status !== 'library') {
        assert(['none', 'shoot', 'permission-needed'].includes(story.image.status), 'This import accepts existing library photos only');
        continue;
      }
      const record = before.media.find(row => row.id === story.image.media_id);
      assert(record && record.credit && record.alt && !record.decorative, 'Library image needs its verified credit and alt text');
      assert.equal(record.caption, story.image.caption); assert.equal(record.credit, story.image.credit);
      const object = await proxy.env.MEDIA.get(record.object_key);
      assert(object, 'Existing local image object is missing');
      images.push({ story: story.key, record, stored_sha256: hash(new Uint8Array(await object.arrayBuffer())) });
    }
    assert.equal(images.length, 1);
    const now = Date.now();
    const journal = { actor, research_sha256: researchHash, imported_at: new Date(now).toISOString(), articles: [], events: [], threads: [], images };
    const statements = [];
    for (const story of research.stories) {
      const row = { id: randomUUID(), slug: story.slug, headline: story.headline, summary: story.summary, body: story.body,
        section: story.section, community: story.community, byline: actor.name, author_id: actor.id,
        lead_media_id: story.image.status === 'library' ? story.image.media_id : null,
        featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now };
      const thread = discussion(row, 'article', now);
      statements.push(insert('news_articles', row), insert('forum_threads', thread),
        audit.auditResource(actor, { type: 'story', id: row.id, label: row.headline }, 'story-create', `/news/${row.slug}; published locally`),
        audit.auditResource(actor, { type: 'story', id: row.id, label: row.headline }, 'story-publish', 'Local editor review'),
        db.prepare("UPDATE facebook_posts SET status='review',updated_at=? WHERE article_id=? AND status='pending' AND attempts=0").bind(now, row.id));
      journal.articles.push(row); journal.threads.push(thread);
    }
    for (const event of research.events) {
      const row = { id: randomUUID(), slug: event.slug, title: event.title, summary: event.summary,
        description: `${event.description}\n\n[Organizer details](${event.source_url})`, category: event.category,
        starts_on: event.starts_on, start_time: event.start_time, ends_on: event.ends_on, end_time: event.end_time,
        hours_note: event.hours_note, venue: event.venue, address: event.address, community: event.community,
        organizer: event.organizer, organizer_url: event.organizer_url, cost: event.cost, link: event.source_url,
        performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '',
        image_media_id: null, status: 'published', created_at: now, updated_at: now };
      const thread = discussion(row, 'event', now);
      statements.push(insert('events', row), insert('forum_threads', thread),
        audit.auditResource(actor, { type: 'event', id: row.id, label: row.title }, 'event-create', `/events/${row.slug}; published locally`),
        audit.auditResource(actor, { type: 'event', id: row.id, label: row.title }, 'event-publish', 'Local editor review'));
      journal.events.push(row); journal.threads.push(thread);
    }
    save('local-before.json', before);
    save('local-import-pending.json', journal);
    const results = await db.batch(statements);
    save('evidence/local-import-batch.json', results);
    assert(results.every(result => result.success && result.meta.changes >= 1));
    save('local-import.json', journal);
  }

  const journal = read('local-import.json'), before = read('local-before.json'), after = await snapshot();
  assert.equal(researchHash, journal.research_sha256, 'Packet changed after import; inspect before changing local copy');
  for (const table of tables) {
    assert.equal(after[table].length, before[table].length + additions[table], table + ' count');
    for (const row of before[table]) {
      assert.deepEqual(after[table].find(current => (current.id ?? current.article_id) === (row.id ?? row.article_id)), row, 'Unexpected existing-row change: ' + table);
    }
  }
  for (const [table, entries] of [['news_articles', journal.articles], ['events', journal.events], ['forum_threads', journal.threads]]) {
    for (const row of entries) {
      const actual = after[table].find(current => current.id === row.id);
      for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, table + '.' + field);
    }
  }
  for (const article of journal.articles) {
    assert.equal(article.author_id, journal.actor.id); assert.equal(article.byline, 'JD'); assert.equal(article.featured, 0);
    const ledger = after.facebook_posts.find(row => row.article_id === article.id);
    assert(ledger && ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id, 'No Facebook delivery may be queued');
  }
  for (const image of journal.images) assert.deepEqual(after.media.find(row => row.id === image.record.id), image.record);
  const report = { checked_at: new Date().toISOString(), author: journal.actor, counts: Object.fromEntries(tables.map(table => [table, { before: before[table].length, after: after[table].length }])),
    existing_rows_unchanged: true, new_stories_featured: false, facebook: 'review, zero attempts; local delivery disabled', media: 'One existing library image reused; no uploads or media-row changes', http: [] };
  if (mode === '--verify-http') {
    for (const [kind, rows] of [['news', journal.articles], ['events', journal.events]]) {
      for (const row of rows) {
        const url = `http://127.0.0.1:4321/${kind}/${row.slug}`;
        const response = await fetch(url); assert.equal(response.status, 200, url);
        const html = await response.text();
        assert(html.includes(escape(row.headline ?? row.title)), 'Rendered headline: ' + url);
        assert(html.includes('/talk/' + journal.threads.find(thread => thread.article_id === row.id || thread.event_id === row.id).id), 'Discussion link: ' + url);
        if (kind === 'news') assert(html.includes('/profile/' + row.author_id), 'Author profile: ' + url);
        const image = journal.images.find(photo => photo.record.id === row.lead_media_id);
        if (image) {
          assert(html.includes(escape(image.record.alt)) && html.includes(escape(image.record.caption)) && html.includes(escape(image.record.credit)), 'Accessible photo attribution: ' + url);
          assert(html.includes('https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG'), 'Photo source link: ' + url);
        }
        if (kind === 'events') {
          assert(html.includes(row.link.replaceAll('&', '&amp;')) || html.includes(row.link), 'Organizer source: ' + url);
          const calendar = await fetch(url + '.ics'); assert.equal(calendar.status, 200);
          const ics = await calendar.text();
          assert(ics.includes('BEGIN:VEVENT') && ics.includes(row.starts_on.replaceAll('-', '')), 'Calendar export: ' + url);
        }
        report.http.push({ url, status: response.status });
      }
    }
    for (const image of journal.images) {
      const url = 'http://127.0.0.1:4321/media/' + image.record.object_key;
      const response = await fetch(url); assert.equal(response.status, 200);
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), image.stored_sha256);
      report.http.push({ url, status: response.status, checksum_verified: true });
    }
    for (const path of ['/news', '/events']) {
      const response = await fetch('http://127.0.0.1:4321' + path); assert.equal(response.status, 200);
      const html = await response.text();
      if (path === '/news') for (const row of journal.articles) assert(html.includes(row.slug), 'Story missing from news list');
      report.http.push({ url: 'http://127.0.0.1:4321' + path, status: response.status });
    }
  }
  save(mode === '--verify-http' ? 'evidence/local-http-verification.json' : 'evidence/local-import-verification.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally { await proxy.dispose(); }
