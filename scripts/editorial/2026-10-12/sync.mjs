import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3,
  'Use --prepare, --publish, --queue or --verify. Production writes require publisher authorization.');
const dir = editorialDirectory('2026-10-12');
const reviewed = JSON.parse(readFileSync(dir + 'import.json', 'utf8'));
const captionRevision = JSON.parse(readFileSync(dir + 'caption-revision.json', 'utf8'));
const origin = 'https://firelandscurrent.com';
const bucket = 'firelands-current-media';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const q = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
const ids = rows => rows.map(row => q(row.id)).join(',');
const tables = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
function cli(args) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const results = JSON.parse(output.slice(output.indexOf('[')));
  assert(results.every(result => result.success), 'D1 query failed');
  return results;
}
function snapshot() {
  const results = query(tables.map(table => `SELECT * FROM ${table};`).join('\n'));
  return Object.fromEntries(tables.map((table, index) => [table, results[index].results]));
}
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
}
function checkBefore(before, data) {
  for (const [table, rows] of [['news_articles', data.articles], ['events', data.events], ['media', data.media], ['forum_threads', data.threads]]) {
    for (const row of rows) assert(!before[table].some(existing => existing.id === row.id || (row.slug && existing.slug === row.slug) ||
      (row.object_key && existing.object_key === row.object_key) || (row.article_id && existing.article_id === row.article_id) ||
      (row.event_id && existing.event_id === row.event_id)), `Production conflict: ${table} ${row.id}`);
  }
  for (const row of data.articles) assert(!before.facebook_posts.some(existing => existing.article_id === row.id));
  for (const row of data.audit) assert(!before.admin_audit_log.some(existing => existing.id === row.id));
  for (const photo of reviewed.images.filter(image => image.reused)) {
    const expected = photo.record.id === captionRevision.before.id ? captionRevision.before : photo.record;
    assert.deepEqual(before.media.find(row => row.id === photo.record.id), expected, 'Reused production image changed');
  }
}
function verifyRows(after, data) {
  for (const [table, rows] of [['news_articles', data.articles], ['events', data.events], ['forum_threads', data.threads], ['media', data.media]]) {
    for (const row of rows) assert.deepEqual(after[table].find(existing => existing.id === row.id), row, `${table}: ${row.id}`);
  }
  for (const photo of reviewed.images.filter(image => image.reused)) assert.deepEqual(after.media.find(row => row.id === photo.record.id), photo.record);
  for (const row of data.audit) assert.deepEqual(after.admin_audit_log.find(existing => existing.id === row.id), row);
  const before = read('production-before.json');
  const additions = { news_articles: data.articles.length, events: data.events.length, forum_threads: data.threads.length, media: data.media.length };
  for (const [table, count] of Object.entries(additions)) {
    assert.equal(after[table].length, before[table].length + count, `${table}: unexpected count`);
    for (const row of before[table]) {
      const expected = table === 'media' && row.id === captionRevision.before.id ? captionRevision.after : row;
      assert.deepEqual(after[table].find(current => current.id === row.id), expected, `Existing ${table} changed unexpectedly`);
    }
  }
}
const htmlEscape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function verifyLive(data) {
  const checked = [];
  for (const [kind, rows] of [['news', data.articles], ['events', data.events]]) {
    for (const row of rows) {
      const url = `${origin}/${kind}/${row.slug}`;
      const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
      assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes(htmlEscape(row.headline ?? row.title)), `${url}: title`);
      assert(html.includes(htmlEscape(row.summary)), `${url}: summary`);
      const discussion = data.threads.find(thread => thread.article_id === row.id || thread.event_id === row.id);
      assert(html.includes(`/talk/${discussion.id}`), `${url}: discussion`);
      if (kind === 'news') {
        const photo = reviewed.images.find(image => image.record.id === row.lead_media_id);
        assert(html.includes(`/profile/${row.author_id}`), `${url}: JD byline`);
        assert(html.includes(`/media/${photo.record.object_key}`), `${url}: photo`);
        assert(html.includes(htmlEscape(photo.record.caption)), `${url}: file-photo caption`);
        assert(html.includes(photo.license_url), `${url}: license`);
        assert(html.includes('property="og:image"'), `${url}: sharing preview`);
      }
      checked.push({ url, status: response.status });
    }
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
  assert(!existsSync(dir + 'production-content.json'), 'Production package already prepared; preserve its journal.');
  assert.equal(read('evidence/http-verification.json').http.length, 10, 'Local review incomplete');
  const before = snapshot();
  const remoteUsers = query("SELECT id,name FROM user WHERE email='jd@orboro.net'; SELECT id FROM user WHERE id='newsroom';");
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  let data;
  try {
    const actor = await proxy.env.DB.prepare('SELECT id,name FROM user WHERE email = ?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD');
    assert.deepEqual(remoteUsers[0].results, [actor]);
    assert.equal(remoteUsers[1].results.length, 1);
    const content = {};
    for (const [key, table, entries] of [['articles', 'news_articles', reviewed.articles], ['events', 'events', reviewed.events], ['threads', 'forum_threads', reviewed.threads], ['media', 'media', reviewed.images.map(image => image.record)]]) {
      const rows = (await proxy.env.DB.prepare(`SELECT * FROM ${table} WHERE id IN (${ids(entries)})`).all()).results;
      assert.equal(rows.length, entries.length);
      for (const entry of entries) {
        const current = rows.find(row => row.id === entry.id);
        for (const [key, value] of Object.entries(entry)) assert.equal(current[key], value, `Reviewed local ${table}.${key} changed`);
      }
      content[key] = rows;
    }
    const localBefore = read('before.json');
    const audit = (await proxy.env.DB.prepare('SELECT * FROM admin_audit_log WHERE created_at >= ?').bind(reviewed.imported_at).all()).results
      .filter(row => !localBefore.admin_audit_log.some(previous => previous.id === row.id) && reviewed.images.some(image => image.record.id === row.target_media_id));
    assert.equal(audit.length, 2, 'Expected new upload and caption correction audits');
    data = { ...content, media: content.media.filter(row => reviewed.images.some(image => !image.reused && image.record.id === row.id)), audit, actor };
    assert.deepEqual([data.articles.length, data.events.length, data.threads.length, data.media.length], [3, 4, 7, 1]);
    mkdirSync(dir + 'production-images', { recursive: true });
    for (const photo of reviewed.images) {
      const object = await proxy.env.MEDIA.get(photo.record.object_key);
      assert(object);
      const bytes = new Uint8Array(await object.arrayBuffer());
      assert.equal(hash(bytes), photo.stored_sha256);
      if (!photo.reused) writeFileSync(dir + 'production-images/' + photo.record.id + '.jpg', bytes);
    }
  } finally { await proxy.dispose(); }
  checkBefore(before, data);
  save('production-before.json', before);
  save('production-content.json', data);
  const now = Date.now();
  const sql = [
    ...data.media.map(row => insert('media', row)),
    `UPDATE media SET caption=${q(captionRevision.after.caption)},updated_at=${captionRevision.after.updated_at} WHERE id=${q(captionRevision.before.id)} AND caption=${q(captionRevision.before.caption)} AND updated_at=${captionRevision.before.updated_at};`,
    ...data.audit.map(row => insert('admin_audit_log', row)),
    ...data.articles.map(row => insert('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insert('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.events.map(row => insert('events', row)), ...data.threads.map(row => insert('forum_threads', row)),
    `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`,
  ];
  writeFileSync(dir + 'sync-production.sql', sql.join('\n') + '\n');
  console.log('Prepared 3 stories, 4 events, 7 discussions, 1 new image and 1 caption correction. Reused media and JD accounts match production.');
} else {
  const data = read('production-content.json');
  if (mode === '--publish') {
    const current = snapshot();
    const alreadyPublished = data.articles.every(article => current.news_articles.some(row => row.id === article.id));
    if (!alreadyPublished) {
      checkBefore(current, data);
      for (const photo of reviewed.images.filter(image => !image.reused)) {
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
    const after = snapshot();
    verifyRows(after, data);
    for (const row of data.articles) assert.equal(after.facebook_posts.find(entry => entry.article_id === row.id).status, 'review');
    const live = await verifyLive(data);
    save('production-publication.json', { published_at: new Date().toISOString(), target: origin, articles: 3, events: 4, discussions: 7, new_images: 1, caption_corrections: 1, live });
    console.log('Production content matches the review; all 17 pages, image files and discussion URLs verified. Facebook ready to queue.');
  } else if (mode === '--queue') {
    assert(existsSync(dir + 'production-publication.json'), 'Verify publication before queuing');
    const after = snapshot();
    verifyRows(after, data);
    const now = Date.now();
    const sql = [];
    for (const article of data.articles) {
      const ledger = after.facebook_posts.find(row => row.article_id === article.id);
      assert(ledger, 'Missing Facebook outbox record');
      if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
      assert(ledger.status === 'review' && ledger.attempts === 0 && ledger.post_id === null, 'Do not retry a delivered or attempted post');
      sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_label,action,detail,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},headline,'facebook_queue',${q(`Story ${article.id}: publisher authorized first-time Facebook delivery after production page and image verification.`)},${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
    }
    if (sql.length) {
      writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
      cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']);
    }
    const ledger = query(`SELECT article_id,status,attempts,post_id,last_error FROM facebook_posts WHERE article_id IN (${ids(data.articles)});`)[0].results;
    assert.equal(ledger.length, 3);
    assert(ledger.every(row => ['pending', 'posting', 'posted'].includes(row.status)));
    save('production-facebook-queue.json', { queued_at: new Date().toISOString(), ledger });
    console.log(JSON.stringify({ facebook: ledger }, null, 2));
  } else {
    const after = snapshot();
    verifyRows(after, data);
    const ledger = after.facebook_posts.filter(row => data.articles.some(article => article.id === row.article_id));
    assert.equal(ledger.length, 3);
    assert(ledger.every(row => ['pending', 'posting', 'posted'].includes(row.status)));
    const actions = after.admin_audit_log.filter(row => row.action === 'facebook_queue' && data.articles.some(article => row.detail?.startsWith(`Story ${article.id}:`)));
    assert.equal(actions.length, 3);
    const local = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
    let sections, eventStatuses;
    try {
      const sectionSql = "SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section";
      const eventSql = 'SELECT status,COUNT(*) AS n FROM events GROUP BY status ORDER BY status';
      const counts = query(sectionSql + ';' + eventSql + ';');
      sections = counts[0].results;
      eventStatuses = counts[1].results;
      assert.deepEqual(sections, (await local.env.DB.prepare(sectionSql).all()).results);
      assert.deepEqual(eventStatuses, (await local.env.DB.prepare(eventSql).all()).results);
    } finally { await local.dispose(); }
    const live = await verifyLive(data);
    const health = query('SELECT * FROM facebook_publisher_health WHERE id=1;')[0].results[0];
    save('production-verification.json', { verified_at: new Date().toISOString(), content_matches_local: true, existing_content_preserved: true,
      shared_caption_corrected: captionRevision.after.id, sections, eventStatuses, facebook: ledger, facebook_health: health, queue_audits: actions, live });
    console.log(JSON.stringify({ content_matches_local: true, articles: 3, events: 4, new_images: 1, facebook: ledger, health }, null, 2));
  }
}
