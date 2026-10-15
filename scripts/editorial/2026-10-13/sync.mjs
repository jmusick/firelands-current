import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3,
  'Use --prepare, --publish, --queue or --verify. This package syncs only the five authorized stories.');
const dir = editorialDirectory('2026-10-13');
const reviewed = JSON.parse(readFileSync(dir + 'import.json', 'utf8'));
const origin = 'https://firelandscurrent.com';
const bucket = 'firelands-current-media';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const q = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
const ids = rows => rows.map(row => q(row.id)).join(',');
const articleIds = ids(reviewed.articles);
const articleSlugs = reviewed.articles.map(row => q(row.slug)).join(',');
const mediaIds = ids(reviewed.images.map(photo => photo.record));
const mediaKeys = reviewed.images.map(photo => q(photo.record.object_key)).join(',');
const selectedThreads = reviewed.threads.filter(thread => reviewed.articles.some(article => article.id === thread.article_id));
function cli(args) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const results = JSON.parse(output.slice(output.indexOf('[')));
  assert(results.every(result => result.success), 'D1 query failed');
  return results.map(result => result.results);
}
function inspect() {
  const names = ['articles', 'threads', 'media', 'facebook', 'users', 'counts', 'sections', 'health', 'queue_audits'];
  const results = query(`
    SELECT * FROM news_articles WHERE id IN (${articleIds}) OR slug IN (${articleSlugs}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${articleIds}) OR id IN (${ids(selectedThreads)}) ORDER BY id;
    SELECT * FROM media WHERE id IN (${mediaIds}) OR object_key IN (${mediaKeys}) ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${articleIds}) ORDER BY article_id;
    SELECT id,name FROM user WHERE email='jd@orboro.net' OR id='newsroom' ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) AS stories,(SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM forum_threads) AS discussions,(SELECT COUNT(*) FROM media) AS images;
    SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;
    SELECT id,actor_id,actor_name,action,detail,created_at FROM admin_audit_log WHERE action='facebook_queue'
      AND (${reviewed.articles.map(article => `detail LIKE ${q(`Story ${article.id}:%`)}`).join(' OR ')}) ORDER BY id;
  `);
  return Object.fromEntries(names.map((name, index) => [name, results[index]]));
}
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
}
function checkBefore(before, data) {
  assert.equal(before.articles.length, 0, 'A selected production story already exists; inspect before writing');
  assert.equal(before.threads.length, 0, 'A selected discussion already exists');
  assert.equal(before.facebook.length, 0, 'A selected Facebook entry already exists');
  assert(before.users.some(user => user.id === data.actor.id && user.name === data.actor.name), 'JD account differs');
  assert(before.users.some(user => user.id === 'newsroom'), 'Newsroom account missing');
  for (const photo of reviewed.images) {
    const existing = before.media.find(row => row.id === photo.record.id || row.object_key === photo.record.object_key);
    if (photo.reused) assert.deepEqual(existing, photo.record, 'Reused production photo changed');
    else assert(!existing, 'New photo conflicts with production media');
  }
}
function verifyRows(after, data) {
  assert.equal(after.articles.length, data.articles.length);
  assert.equal(after.threads.length, data.threads.length);
  for (const [key, rows] of [['articles', data.articles], ['threads', data.threads]]) {
    for (const row of rows) assert.deepEqual(after[key].find(current => current.id === row.id), row, `${key}: ${row.id}`);
  }
  for (const photo of reviewed.images) assert.deepEqual(after.media.find(row => row.id === photo.record.id), photo.record);
}
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function verifyLive(data) {
  const checked = [];
  for (const row of data.articles) {
    const url = `${origin}/news/${row.slug}`;
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, url);
    const html = await response.text();
    assert(html.includes(escape(row.headline)), `${url}: headline`);
    assert(html.includes(escape(row.summary)), `${url}: summary`);
    assert(html.includes(`/profile/${row.author_id}`), `${url}: JD byline`);
    const thread = data.threads.find(thread => thread.article_id === row.id);
    assert(html.includes(`/talk/${thread.id}`), `${url}: discussion`);
    const photo = reviewed.images.find(photo => photo.record.id === row.lead_media_id);
    if (photo) {
      assert(html.includes(`/media/${photo.record.object_key}`), `${url}: image`);
      assert(html.includes(escape(photo.record.caption)), `${url}: caption`);
      assert(html.includes(photo.license_url), `${url}: license`);
    }
    assert(html.includes('property="og:image"'), `${url}: Facebook preview`);
    checked.push({ url, status: response.status, byline_verified: true, image: photo?.record.id ?? 'site-masthead' });
  }
  for (const photo of reviewed.images) {
    const url = `${origin}/media/${photo.record.object_key}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('content-type'), photo.record.content_type);
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), photo.stored_sha256, `${url}: checksum`);
    checked.push({ url, status: response.status, checksum_matches: true });
  }
  for (const thread of data.threads) {
    const url = `${origin}/talk/${thread.id}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, url);
    checked.push({ url, status: response.status });
  }
  return checked;
}

if (mode === '--prepare') {
  assert(!existsSync(dir + 'production-content.json'), 'Preserve the existing production journal');
  assert.equal(read('evidence/http-verification.json').http.length, 13, 'Local review incomplete');
  const before = inspect();
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  let data;
  try {
    const actor = await proxy.env.DB.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD');
    const content = {};
    for (const [key, table, entries] of [['articles', 'news_articles', reviewed.articles], ['threads', 'forum_threads', selectedThreads]]) {
      const rows = (await proxy.env.DB.prepare(`SELECT * FROM ${table} WHERE id IN (${ids(entries)}) ORDER BY id`).all()).results;
      assert.equal(rows.length, entries.length);
      for (const entry of entries) for (const [field, value] of Object.entries(entry)) {
        assert.equal(rows.find(row => row.id === entry.id)[field], value, `Reviewed local ${table}.${field} changed`);
      }
      content[key] = rows;
    }
    const newImages = reviewed.images.filter(photo => !photo.reused);
    const media = [];
    mkdirSync(dir + 'production-images', { recursive: true });
    for (const photo of reviewed.images) {
      const row = await proxy.env.DB.prepare('SELECT * FROM media WHERE id=?').bind(photo.record.id).first();
      assert.deepEqual(row, photo.record);
      const object = await proxy.env.MEDIA.get(row.object_key);
      assert(object, 'Local image missing');
      const bytes = new Uint8Array(await object.arrayBuffer());
      assert.equal(hash(bytes), photo.stored_sha256);
      if (!photo.reused) {
        writeFileSync(dir + 'production-images/' + row.id + '.jpg', bytes);
        media.push(row);
      }
    }
    const audit = (await proxy.env.DB.prepare(`SELECT * FROM admin_audit_log WHERE action='media-upload' AND target_media_id IN (${ids(media)}) ORDER BY id`).all()).results;
    assert.equal(audit.length, newImages.length);
    data = { ...content, media, audit, actor };
    assert.deepEqual([data.articles.length, data.threads.length, data.media.length], [5, 5, 2]);
  } finally { await proxy.dispose(); }
  checkBefore(before, data);
  save('production-before.json', before);
  save('production-content.json', data);
  const now = Date.now();
  // Hold delivery while checking live pages, even if a scheduled publisher runs during the import.
  const sql = [...data.media.map(row => insert('media', row)), ...data.audit.map(row => insert('admin_audit_log', row)),
    ...data.articles.map(row => insert('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insert('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.threads.map(row => insert('forum_threads', row)),
    `UPDATE news_articles SET status='published' WHERE id IN (${articleIds});`];
  writeFileSync(dir + 'sync-production.sql', sql.join('\n') + '\n');
  console.log('Prepared five stories, five discussions and two new images. Five calendar events remain local.');
} else {
  const data = read('production-content.json');
  if (mode === '--publish') {
    const current = inspect();
    if (current.articles.length === 0) {
      checkBefore(current, data);
      for (const photo of reviewed.images.filter(photo => !photo.reused)) {
        const file = dir + 'production-images/' + photo.record.id + '.jpg';
        assert.equal(hash(readFileSync(file)), photo.stored_sha256);
        console.log(`Uploading ${photo.filename} to production R2`);
        cli(['r2', 'object', 'put', `${bucket}/${photo.record.object_key}`, '--remote', '--file', file, '--content-type', photo.record.content_type]);
        const fetched = dir + 'production-images/verified-' + photo.record.id + '.jpg';
        cli(['r2', 'object', 'get', `${bucket}/${photo.record.object_key}`, '--remote', '--file', fetched]);
        assert.equal(hash(readFileSync(fetched)), photo.stored_sha256);
      }
      cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'sync-production.sql', '--yes']);
    }
    const after = inspect();
    verifyRows(after, data);
    assert(after.facebook.every(row => row.status === 'review' && row.attempts === 0 && !row.post_id));
    const live = await verifyLive(data);
    save('production-publication.json', { published_at: new Date().toISOString(), target: origin, articles: 5, events: 0, discussions: 5, new_images: 2, counts: after.counts, live });
    console.log('Five live stories, three image files and five discussions verified. Facebook posts ready to queue.');
  } else if (mode === '--queue') {
    assert(existsSync(dir + 'production-publication.json'), 'Verify live publication before queuing');
    const after = inspect();
    verifyRows(after, data);
    const now = Date.now();
    const sql = [];
    for (const article of data.articles) {
      const ledger = after.facebook.find(row => row.article_id === article.id);
      assert(ledger, 'Facebook entry missing');
      if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
      assert(ledger.status === 'review' && ledger.attempts === 0 && ledger.post_id === null, 'Do not retry attempted delivery');
      sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_label,action,detail,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},headline,'facebook_queue',${q(`Story ${article.id}: publisher authorized first-time Facebook delivery after live page and image verification.`)},${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
    }
    if (sql.length) {
      writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
      cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']);
    }
    const queued = inspect();
    assert.equal(queued.facebook.length, 5);
    assert(queued.facebook.every(row => ['pending', 'posting', 'posted'].includes(row.status)));
    assert.equal(queued.queue_audits.length, 5);
    save('production-facebook-queue.json', { queued_at: new Date().toISOString(), ledger: queued.facebook, queue_audits: queued.queue_audits });
    console.log(JSON.stringify({ facebook: queued.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error })) }, null, 2));
  } else {
    const after = inspect();
    verifyRows(after, data);
    assert.equal(after.facebook.length, 5);
    assert(after.facebook.every(row => ['pending', 'posting', 'posted'].includes(row.status)));
    assert.equal(after.queue_audits.length, 5);
    const before = read('production-before.json').counts[0];
    const counts = after.counts[0];
    assert.equal(counts.stories, before.stories + 5);
    assert.equal(counts.images, before.images + 2);
    assert.equal(counts.events, before.events, 'Calendar changed unexpectedly');
    const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
    try {
      const localSections = (await proxy.env.DB.prepare("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
      assert.deepEqual(after.sections, localSections, 'Local and production story sections differ');
    } finally { await proxy.dispose(); }
    const live = await verifyLive(data);
    save('production-verification.json', { verified_at: new Date().toISOString(), stories_match_local: true, events_synced: false, counts, sections: after.sections, facebook: after.facebook, facebook_health: after.health, queue_audits: after.queue_audits, live });
    console.log(JSON.stringify({ stories_match_local: true, stories: 5, events_synced: 0, images_uploaded: 2, counts, facebook: after.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error })), health: after.health }, null, 2));
  }
}
