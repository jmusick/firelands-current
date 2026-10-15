import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3);
const dir = editorialDirectory('2026-10-15');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const reviewed = read('local-import.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const q = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
const ids = rows => rows.map(row => q(row.id)).join(',');
const articles = reviewed.articles;
const events = [...reviewed.events, reviewed.updates[0].after];
const images = reviewed.images.map(image => image.record);
assert.equal(articles.length, 4); assert.equal(reviewed.events.length, 4); assert.equal(images.length, 1);
assert.equal(reviewed.updates.length, 1);
assert.equal(reviewed.updates[0].before.slug, 'perkins-night-of-lights-2026');

function cli(args) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const result = JSON.parse(output.slice(output.indexOf('[')));
  assert(result.every(row => row.success));
  return result.map(row => row.results);
}
function inspect() {
  const names = ['articles', 'events', 'threads', 'media', 'facebook', 'users', 'counts', 'sections', 'health', 'audits', 'migrations'];
  const result = query(`
    SELECT * FROM news_articles WHERE id IN (${ids(articles)}) OR slug IN (${articles.map(row => q(row.slug)).join(',')}) ORDER BY id;
    SELECT * FROM events WHERE id IN (${ids(events)}) OR slug IN (${events.map(row => q(row.slug)).join(',')}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${ids(articles)}) OR event_id IN (${ids(events)}) OR id IN (${ids(reviewed.threads)}) ORDER BY id;
    SELECT * FROM media WHERE id IN (${ids(images)}) OR object_key IN (${images.map(row => q(row.object_key)).join(',')}) ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids(articles)}) ORDER BY article_id;
    SELECT id,name FROM user WHERE email='jd@orboro.net' OR id='newsroom' ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) AS stories,(SELECT COUNT(*) FROM events) AS events,(SELECT COUNT(*) FROM forum_threads) AS discussions,(SELECT COUNT(*) FROM media) AS images;
    SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;
    SELECT * FROM admin_audit_log WHERE target_id IN (${ids([...articles, ...events])}) OR target_media_id IN (${ids(images)}) OR (action='facebook_queue' AND (${articles.map(row => `detail LIKE ${q('Story ' + row.id + ':%')}`).join(' OR ')})) ORDER BY id;
    SELECT name FROM d1_migrations ORDER BY id;
  `);
  return Object.fromEntries(names.map((name, index) => [name, result[index]]));
}
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
}
function checkBefore(current, data) {
  assert.equal(current.articles.length, 0, 'Story already present or slug conflict; inspect before retrying');
  assert.equal(current.media.length, 0, 'Image already exists; inspect before uploading');
  for (const row of data.events) assert(!current.events.some(existing => existing.id === row.id || existing.slug === row.slug), 'New event conflict');
  for (const row of data.threads) assert(!current.threads.some(existing => existing.id === row.id || (row.article_id && existing.article_id === row.article_id) || (row.event_id && existing.event_id === row.event_id)), 'Discussion conflict');
  assert(current.users.some(row => row.id === data.actor.id && row.name === data.actor.name));
  assert(current.users.some(row => row.id === 'newsroom'));
  assert.equal(current.facebook.length, 0);
  for (const update of data.updates) assert.deepEqual(current.events.find(row => row.id === update.before.id), update.before, 'Existing event changed after preparation');
  for (const row of data.audits) assert(!current.audits.some(existing => existing.id === row.id), 'Audit already exists');
}
function verifyRows(current, data) {
  for (const [key, entries] of Object.entries({ articles: data.articles, events: data.events, threads: data.threads, media: data.media, audits: data.audits })) for (const row of entries) {
    const actual = current[key].find(existing => existing.id === row.id);
    for (const [field, value] of Object.entries(row)) assert.equal(actual?.[field], value, `${key}.${field}`);
  }
  for (const update of data.updates) assert.deepEqual(current.events.find(row => row.id === update.before.id), { ...update.before, ...update.fields });
}
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function verifyLive(data) {
  const checked = [];
  for (const [kind, rows] of [['news', articles], ['events', events]]) for (const row of rows) {
    const url = `https://firelandscurrent.com/${kind}/${row.slug}`;
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, url);
    const html = await response.text();
    assert(html.includes(escape(row.headline ?? row.title)) && html.includes(escape(row.summary)), url + ': title and summary');
    if (kind === 'news') {
      assert(html.includes('/profile/' + row.author_id), url + ': JD byline');
      assert(html.includes('property="og:image"'), url + ': social preview');
      const photo = reviewed.images.find(image => image.record.id === row.lead_media_id);
      if (photo) assert(html.includes('/media/' + photo.record.object_key) && html.includes(escape(photo.record.caption)) && html.includes(photo.license_url));
    }
    const discussion = data.threads.find(thread => thread.article_id === row.id || thread.event_id === row.id);
    if (discussion) assert(html.includes('/talk/' + discussion.id), url + ': discussion');
    if (row.id === reviewed.updates[0].after.id) assert(html.includes('Vendors may apply through') && html.includes('refundable after the event'), url + ': vendor update');
    checked.push({ url, status: response.status });
  }
  for (const photo of reviewed.images) {
    const url = 'https://firelandscurrent.com/media/' + photo.record.object_key;
    const response = await fetch(url); assert.equal(response.status, 200);
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), photo.stored_sha256);
    checked.push({ url, status: response.status, checksum_verified: true });
  }
  return checked;
}

if (mode === '--prepare') {
  assert(!existsSync(dir + 'production-content.json'), 'Preserve the production package; inspect prior results');
  const before = inspect();
  const data = { actor: reviewed.actor, articles, events: reviewed.events, threads: reviewed.threads, media: images, audits: [], updates: [] };
  const localUpdate = reviewed.updates[0];
  const remoteEvent = before.events.find(row => row.id === localUpdate.before.id);
  const normalizeLines = value => value.replaceAll('\r\n', '\n');
  assert(remoteEvent && normalizeLines(remoteEvent.description) === normalizeLines(localUpdate.before.description) && remoteEvent.slug === localUpdate.before.slug, 'Existing production event details differ from reviewed baseline');
  const vendor = read('research.json').updates.find(update => update.slug === remoteEvent.slug && update.status === 'ready');
  assert(vendor && normalizeLines(localUpdate.after.description) === normalizeLines(localUpdate.before.description) + '\n\n' + vendor.proposed_copy);
  data.updates.push({ before: remoteEvent, fields: { description: remoteEvent.description + '\n\n' + vendor.proposed_copy, updated_at: localUpdate.after.updated_at } });
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  try {
    assert.deepEqual(await proxy.env.DB.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first(), data.actor);
    for (const [table, rows] of [['news_articles', articles], ['events', events]]) for (const row of rows) {
      const actual = await proxy.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(row.id).first();
      for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, `${table}.${field}`);
    }
    const localMigrations = (await proxy.env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results;
    assert.deepEqual(before.migrations.map(row => row.name).sort(), localMigrations.map(row => row.name).sort(), 'Apply required migrations deliberately before syncing');
    mkdirSync(dir + 'production-images', { recursive: true });
    for (const photo of reviewed.images) {
      const object = await proxy.env.MEDIA.get(photo.record.object_key); assert(object);
      const bytes = new Uint8Array(await object.arrayBuffer()); assert.equal(hash(bytes), photo.stored_sha256);
      writeFileSync(dir + 'production-images/' + photo.record.id + '.jpg', bytes);
    }
    const targetIds = [...articles, ...events].map(row => row.id);
    data.audits = (await proxy.env.DB.prepare(`SELECT * FROM admin_audit_log WHERE target_id IN (${targetIds.map(() => '?').join(',')}) OR target_media_id=? ORDER BY id`).bind(...targetIds, images[0].id).all()).results;
    assert.equal(data.audits.length, 18);
  } finally { await proxy.dispose(); }
  checkBefore(before, data);
  save('production-before.json', before); save('production-content.json', data);
  const now = Date.now();
  const sql = [...data.media.map(row => insert('media', row)),
    ...data.articles.map(row => insert('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insert('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.events.map(row => insert('events', row)), ...data.threads.map(row => insert('forum_threads', row)),
    ...data.updates.map(update => `UPDATE events SET description=${q(update.fields.description)},updated_at=${update.fields.updated_at} WHERE id=${q(update.before.id)} AND updated_at=${update.before.updated_at};`),
    ...data.audits.map(row => insert('admin_audit_log', row)),
    `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`];
  writeFileSync(dir + 'sync-production.sql', sql.join('\n') + '\n');
  console.log(JSON.stringify({ prepared_stories: articles.length, prepared_events: data.events.length, updated_events: data.updates.length, discussions: data.threads.length, images: data.media.length, audits: data.audits.length, migrations_match: true }));
} else {
  const data = read('production-content.json');
  if (mode === '--publish') {
    const current = inspect();
    if (!current.articles.some(row => row.id === articles[0].id)) {
      checkBefore(current, data);
      for (const photo of reviewed.images) {
        const file = dir + 'production-images/' + photo.record.id + '.jpg';
        assert.equal(hash(readFileSync(file)), photo.stored_sha256);
        cli(['r2', 'object', 'put', 'firelands-current-media/' + photo.record.object_key, '--remote', '--file', file, '--content-type', photo.record.content_type]);
        const verified = dir + 'production-images/verified-' + photo.record.id + '.jpg';
        cli(['r2', 'object', 'get', 'firelands-current-media/' + photo.record.object_key, '--remote', '--file', verified]);
        assert.equal(hash(readFileSync(verified)), photo.stored_sha256);
      }
      cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'sync-production.sql', '--yes']);
    }
    const after = inspect(); verifyRows(after, data);
    for (const article of articles) {
      const ledger = after.facebook.find(row => row.article_id === article.id);
      assert(ledger?.status === 'review' && ledger.attempts === 0 && !ledger.post_id);
    }
    save('production-publication.json', { published_at: new Date().toISOString(), counts: after.counts, live: await verifyLive(data) });
    console.log('Four stories, four events, existing event update and image verified live; Facebook remains held until --queue.');
  } else if (mode === '--queue') {
    assert(existsSync(dir + 'production-publication.json'));
    const current = inspect(); verifyRows(current, data);
    const sql = [], now = Date.now();
    for (const article of articles) {
      const ledger = current.facebook.find(row => row.article_id === article.id); assert(ledger);
      if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
      assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id, 'Delivery already attempted; do not retry blindly');
      sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_label,action,detail,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},headline,'facebook_queue',${q('Story ' + article.id + ': publisher authorized first-time delivery after production story and image verification.')},${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
    }
    if (sql.length) {
      writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
      cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']);
    }
    const after = inspect();
    assert.equal(after.audits.filter(row => row.action === 'facebook_queue').length, 4);
    assert(articles.every(article => after.facebook.some(row => row.article_id === article.id && ['pending', 'posting', 'posted'].includes(row.status))));
    save('production-facebook-queue.json', { queued_at: new Date().toISOString(), facebook: after.facebook });
    console.log(JSON.stringify(after.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error })), null, 2));
  } else {
    const after = inspect(); verifyRows(after, data);
    const before = read('production-before.json');
    for (const [key, n] of [['stories', 4], ['events', 4], ['discussions', 8], ['images', 1]]) assert.equal(after.counts[0][key], before.counts[0][key] + n);
    assert.equal(after.audits.filter(row => row.action === 'facebook_queue').length, 4);
    const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
    try {
      const sections = (await proxy.env.DB.prepare("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
      assert.deepEqual(after.sections, sections);
    } finally { await proxy.dispose(); }
    const report = { checked_at: new Date().toISOString(), counts: after.counts[0], sections_match_local: true, facebook: after.facebook, publisher_health: after.health, live: await verifyLive(data) };
    save('production-verification.json', report);
    console.log(JSON.stringify({ ...report, live: report.live.length }, null, 2));
  }
}
