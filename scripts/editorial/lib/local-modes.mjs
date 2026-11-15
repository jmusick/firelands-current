// --apply-local, --verify-local and --verify-http: import a reviewed packet into the local database and
// check what landed. Nothing here can reach production; the production modes read the journal this writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertUnchanged, baselineHash, packetPath, updateTable } from './manifest.mjs';
import { checkPages } from './http.mjs';
import { insertStatement, rowKey, TABLES } from './local.mjs';
import { hash, slugPattern } from './util.mjs';

export function checkWindow(manifest, { ignoreWindow = false } = {}) {
  if (!manifest.publish_window || ignoreWindow) return;
  assert(Date.now() < Date.parse(manifest.publish_window.until), 'The budget date has passed; re-review the packet before importing, publishing or queuing it (--ignore-window is for throwaway rehearsals only)');
}

const discussion = (row, kind, now) => ({ id: randomUUID(), author_id: 'newsroom', title: row.headline ?? row.title, body: row.summary,
  [kind + '_id']: row.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now });

function storyRow(story, actor, mediaIds, now) {
  return { id: randomUUID(), slug: story.slug, headline: story.headline, summary: story.summary, body: story.body,
    section: story.section, community: story.community, byline: actor.name, author_id: actor.id,
    lead_media_id: story.media ? mediaIds.get(story.media) : null, featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now };
}

function eventRow(event, now) {
  return { id: randomUUID(), slug: event.slug, title: event.title, summary: event.summary,
    description: `${event.description}\n\n[Organizer details](${event.source_url})`, category: event.category,
    starts_on: event.starts_on, start_time: event.start_time ?? null, ends_on: event.ends_on ?? null, end_time: event.end_time ?? null,
    hours_note: event.hours_note ?? '', venue: event.venue ?? '', address: event.address ?? '', community: event.community ?? '',
    organizer: event.organizer ?? '', organizer_url: event.organizer_url ?? '', cost: event.cost ?? '', link: event.source_url,
    performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '',
    image_media_id: null, status: 'published', created_at: now, updated_at: now };
}

async function prepareMedia({ manifest, journal, local, before, actor }) {
  const images = [], uploads = [], statements = [], mediaIds = new Map();
  try {
    for (const item of manifest.media) {
      if (item.action === 'reuse') {
        const record = before.media.find(row => row.id === item.id);
        assert(record && record.credit && record.alt && !record.decorative, `Library photo ${item.key} needs its credit and alt text`);
        assert.equal(record.caption, item.caption, `Caption of ${item.key} differs from the library`);
        assert.equal(record.credit, item.credit, `Credit of ${item.key} differs from the library`);
        const object = await local.env.MEDIA.get(record.object_key);
        assert(object, 'The library photo is missing from the local bucket: ' + record.object_key);
        const stored = hash(new Uint8Array(await object.arrayBuffer()));
        assert.equal(stored, item.sha256, `Stored photo ${item.key} differs from the reviewed checksum`);
        images.push({ key: item.key, action: 'reuse', record, stored_sha256: stored });
        mediaIds.set(item.key, record.id);
      } else {
        const media = await local.media();
        const original = readFileSync(packetPath(journal.packetDir, item.file));
        if (item.original_sha256) assert.equal(hash(original), item.original_sha256, `Original file for ${item.key} changed`);
        const filename = item.file.split('/').pop();
        const checked = await media.checkUpload(new File([original], filename, { type: item.content_type ?? 'image/jpeg' }));
        assert.notEqual(typeof checked, 'string', String(checked));
        const details = { alt: item.alt, decorative: false, caption: item.caption, credit: item.credit, source: item.source };
        assert.deepEqual(media.validateDetails(details), []);
        const { record, statement } = await media.storeMedia(checked, filename, details, actor.id);
        uploads.push(record);
        if (item.stored_sha256) assert.equal(hash(checked.bytes), item.stored_sha256, `Validated file for ${item.key} differs from the reviewed one`);
        const validatedFile = `images/${item.key}-validated.${checked.ext}`;
        journal.saveBytes(validatedFile, checked.bytes);
        statements.push(statement, media.mediaAudit(actor, record, 'media-upload', item.audit_detail ?? 'Licensed photo; source and license verified'));
        images.push({ key: item.key, action: 'upload', record, original_sha256: hash(original), stored_sha256: hash(checked.bytes), validated_file: validatedFile });
        mediaIds.set(item.key, record.id);
      }
    }
    return { images, uploads, statements, mediaIds };
  } catch (error) {
    if (uploads.length) await (await local.media()).discardUnsavedMedia(uploads);
    throw error;
  }
}

export async function applyLocal({ loaded, journal, local, options }) {
  const { manifest } = loaded;
  assert(!journal.exists('local-import.json') && !journal.exists('local-import-pending.json'), 'A local import journal exists; inspect it before retrying');
  checkWindow(manifest, options);
  const { db } = local;
  const audit = await local.audit();
  const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind(manifest.author.email).first();
  assert(actor && actor.name === manifest.author.name, 'The author account is required locally');
  assert(await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first(), 'The discussion author is required');
  const before = await local.snapshot();
  for (const [table, entries] of [['news_articles', manifest.stories], ['events', manifest.events]]) {
    const slugs = new Set(before[table].map(row => row.slug));
    for (const entry of entries) {
      assert(slugPattern.test(entry.slug) && entry.slug.length <= 120);
      assert(!slugs.has(entry.slug), 'Duplicate slug: ' + entry.slug);
    }
  }
  journal.create('local-import-pending.json', { manifest_sha256: loaded.manifestSha256, stage: 'validating' });
  let pendingUploads = [];
  try {
    const { images, uploads, statements: mediaStatements, mediaIds } = await prepareMedia({ manifest, journal, local, before, actor });
    pendingUploads = uploads;
    const now = Date.now();
    const data = { manifest_sha256: loaded.manifestSha256, inputs_sha256: loaded.inputs, actor, imported_at: new Date(now).toISOString(),
      articles: [], events: [], threads: [], images, changed: [], updates: [], features: [], audits: [] };
    const statements = [...mediaStatements];
    const facebook = [], publish = [];
    const label = (type, row) => ({ type, id: row.id, label: row.headline ?? row.title });
    for (const story of manifest.stories) {
      const row = storyRow(story, actor, mediaIds, now), thread = discussion(row, 'article', now);
      // The review row exists before the story is published, so the publication trigger cannot queue a delivery.
      statements.push(insertStatement(db, 'news_articles', { ...row, status: 'draft' }),
        insertStatement(db, 'facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now }),
        insertStatement(db, 'forum_threads', thread),
        audit.auditResource(actor, label('story', row), 'story-create', `/news/${row.slug}; published locally`),
        audit.auditResource(actor, label('story', row), 'story-publish', 'Local editor review'));
      publish.push(row.id); facebook.push(row.id);
      data.articles.push(row); data.threads.push(thread);
    }
    for (const event of manifest.events) {
      const row = eventRow(event, now), thread = discussion(row, 'event', now);
      statements.push(insertStatement(db, 'events', row), insertStatement(db, 'forum_threads', thread),
        audit.auditResource(actor, label('event', row), 'event-create', `/events/${row.slug}; published locally`),
        audit.auditResource(actor, label('event', row), 'event-publish', 'Local editor review'));
      data.events.push(row); data.threads.push(thread);
    }
    const current = new Map(); // table:id -> the row as this packet leaves it, so two changes to one story compose.
    const changedRow = async (table, slug) => {
      const row = await db.prepare(`SELECT * FROM ${table} WHERE slug=?`).bind(slug).first();
      assert(row && row.status === 'published', `Existing ${table} row to change is missing or unpublished: ${slug}`);
      return { key: table + ':' + row.id, row: current.get(table + ':' + row.id) ?? row, original: row };
    };
    for (const update of manifest.updates) {
      const table = updateTable(update);
      const { key, row, original } = await changedRow(table, update.slug);
      assert.equal(baselineHash(original, Object.keys(update.fields)), update.baseline_sha256, 'Update target changed since it was reviewed: ' + update.slug);
      assert(await db.prepare(`SELECT id FROM forum_threads WHERE ${table === 'events' ? 'event_id' : 'article_id'}=?`).bind(original.id).first(), 'Existing discussion must remain: ' + update.slug);
      const fields = { ...update.fields, updated_at: now }, after = { ...row, ...fields };
      statements.push(db.prepare(`UPDATE ${table} SET ${Object.keys(fields).map(name => name + '=?').join(',')} WHERE id=? AND updated_at=?`).bind(...Object.values(fields), row.id, row.updated_at),
        audit.auditResource(actor, label(table === 'events' ? 'event' : 'story', after), table === 'events' ? 'event-update' : 'story-update', `Changed: ${Object.keys(update.fields).join(', ')}; local editor review`));
      current.set(key, after); data.updates.push({ table, slug: update.slug, fields });
    }
    for (const feature of manifest.features) {
      const { key, row } = await changedRow('news_articles', feature.slug);
      assert.notEqual(Boolean(row.featured), feature.featured, 'Feature selection is already as requested: ' + feature.slug);
      const after = { ...row, featured: feature.featured ? 1 : 0 };
      statements.push(db.prepare('UPDATE news_articles SET featured=? WHERE id=? AND featured=?').bind(after.featured, row.id, row.featured),
        audit.auditResource(actor, label('story', after), feature.featured ? 'story-feature' : 'story-unfeature', 'Local editor review'));
      current.set(key, after); data.features.push({ slug: feature.slug, featured: feature.featured });
    }
    if (publish.length) statements.push(db.prepare(`UPDATE news_articles SET status='published' WHERE status='draft' AND id IN (${publish.map(() => '?').join(',')})`).bind(...publish));
    for (const [key, after] of current) {
      const [table, id] = key.split(/:(.+)/);
      data.changed.push({ table, before: before[table].find(row => row.id === id), after });
    }
    const expectedAudits = 2 * (manifest.stories.length + manifest.events.length) + manifest.updates.length + manifest.features.length + uploads.length;
    journal.save('local-before.json', before);
    journal.save('local-import-pending.json', data);
    let results;
    if (uploads.length) {
      const media = await local.media();
      try { results = await media.batchWithUploads(uploads, statements); }
      catch (error) { await media.discardUnsavedMedia(uploads); throw error; }
    } else results = await db.batch(statements);
    journal.save('evidence/local-import-batch.json', results);
    assert(results.every(result => result.success && result.meta.changes >= 1), 'A local write changed no rows');
    const knownAudits = new Set(before.admin_audit_log.map(row => row.id));
    data.audits = (await db.prepare('SELECT * FROM admin_audit_log').all()).results.filter(row => !knownAudits.has(row.id));
    assert.equal(data.audits.length, expectedAudits, 'Unexpected number of audit entries');
    journal.save('local-import.json', data);
    return await verifyLocal({ loaded, journal, local });
  } catch (error) {
    if (pendingUploads.length) await (await local.media()).discardUnsavedMedia(pendingUploads);
    throw error;
  }
}

function expectedRow(data, table, row) {
  return data.changed.find(change => change.table === table && change.before.id === row.id)?.after ?? row;
}

export async function checkLocalState({ data, before, after }) {
  const uploads = data.images.filter(image => image.action === 'upload').length;
  const deltas = { news_articles: data.articles.length, events: data.events.length, forum_threads: data.threads.length, media: uploads, facebook_posts: data.articles.length, admin_audit_log: data.audits.length };
  for (const table of TABLES) {
    assert.equal(after[table].length, before[table].length + deltas[table], table + ' count');
    for (const row of before[table]) {
      assert.deepEqual(after[table].find(item => rowKey(item) === rowKey(row)), expectedRow(data, table, row), 'Unexpected change to an existing row in ' + table);
    }
  }
  for (const [table, rows] of [['news_articles', data.articles], ['events', data.events], ['forum_threads', data.threads], ['admin_audit_log', data.audits]]) {
    for (const row of rows) {
      const actual = after[table].find(item => item.id === row.id);
      assert(actual, `${table} row missing: ${row.id}`);
      for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, `${table}.${field}`);
    }
  }
  for (const article of data.articles) {
    assert.equal(article.author_id, data.actor.id); assert.equal(article.byline, data.actor.name); assert.equal(article.featured, 0);
    const ledger = after.facebook_posts.find(row => row.article_id === article.id);
    assert(ledger && ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id, 'No Facebook delivery may be queued locally');
  }
  for (const image of data.images) assert.deepEqual(after.media.find(row => row.id === image.record.id), image.record);
  return { counts: Object.fromEntries(TABLES.map(table => [table, { before: before[table].length, after: after[table].length }])),
    existing_rows_unchanged_except: data.changed.map(change => ({ table: change.table, slug: change.after.slug })),
    facebook: 'review, zero attempts; local delivery disabled',
    media: { reused: data.images.filter(i => i.action === 'reuse').length, uploaded: uploads } };
}

export async function verifyLocal({ loaded, journal, local }) {
  const data = journal.read('local-import.json'), before = journal.read('local-before.json');
  assertUnchanged(data, loaded);
  const report = { checked_at: new Date().toISOString(), author: data.actor, ...await checkLocalState({ manifest: loaded.manifest, data, before, after: await local.snapshot() }) };
  journal.save('evidence/local-import-verification.json', report);
  return report;
}

export async function verifyHttp({ loaded, journal, local, origin }) {
  const data = journal.read('local-import.json'), before = journal.read('local-before.json');
  assertUnchanged(data, loaded);
  const after = await local.snapshot();
  const state = await checkLocalState({ manifest: loaded.manifest, data, before, after });
  const http = await checkPages(origin, { manifest: loaded.manifest, articles: data.articles, events: data.events,
    updatedArticles: data.changed.filter(change => change.table === 'news_articles').map(change => change.after),
    updatedEvents: data.changed.filter(change => change.table === 'events').map(change => change.after),
    threads: after.forum_threads, images: data.images }, { lists: true });
  const report = { checked_at: new Date().toISOString(), author: data.actor, ...state, http };
  journal.save('evidence/local-http-verification.json', report);
  return report;
}
