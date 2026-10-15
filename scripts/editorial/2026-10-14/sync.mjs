import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode));
const dir = editorialDirectory('2026-10-14');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, data) => writeFileSync(dir + name, JSON.stringify(data, null, 2) + '\n');
const reviewed = read('import.json');
const q = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
const ids = rows => rows.map(row => q(row.id)).join(',');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paradeArticle = reviewed.updates.find(update => update.table === 'news_articles');
const paradeEvent = reviewed.updates.find(update => update.table === 'events');
const articles = [...reviewed.articles, paradeArticle.after];
const events = [...reviewed.events, paradeEvent.after];
function cli(args) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const result = JSON.parse(output.slice(output.indexOf('[')));
  assert(result.every(result => result.success));
  return result.map(result => result.results);
}
function inspect() {
  const names = ['articles', 'events', 'threads', 'media', 'facebook', 'users', 'counts', 'sections', 'health', 'queue_audits'];
  const results = query(`
    SELECT * FROM news_articles WHERE id IN (${ids(articles)}) OR slug IN (${articles.map(row => q(row.slug)).join(',')}) ORDER BY id;
    SELECT * FROM events WHERE id IN (${ids(events)}) OR slug IN (${events.map(row => q(row.slug)).join(',')}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${ids(articles)}) OR event_id IN (${ids(events)}) ORDER BY id;
    SELECT * FROM media WHERE id IN (${ids(reviewed.images.map(photo => photo.record))}) ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids(articles)}) ORDER BY article_id;
    SELECT id,name FROM user WHERE email='jd@orboro.net' OR id='newsroom' ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) AS stories,(SELECT COUNT(*) FROM events) AS events,(SELECT COUNT(*) FROM forum_threads) AS discussions,(SELECT COUNT(*) FROM media) AS images;
    SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;
    SELECT id,actor_id,actor_name,action,detail,created_at FROM admin_audit_log WHERE action='facebook_queue' AND (${reviewed.articles.map(row => `detail LIKE ${q('Story ' + row.id + ':%')}`).join(' OR ')}) ORDER BY id;
  `);
  return Object.fromEntries(names.map((name, i) => [name, results[i]]));
}
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
}
function updateSQL(update) {
  return `UPDATE ${update.table} SET ${Object.entries(update.fields).map(([key, value]) => key + '=' + q(value)).join(',')} WHERE id=${q(update.before.id)} AND updated_at=${update.before.updated_at};`;
}
function checkBefore(current, data) {
  for (const row of data.articles) assert(!current.articles.some(existing => existing.id === row.id || existing.slug === row.slug), 'Production story conflict');
  for (const row of data.events) assert(!current.events.some(existing => existing.id === row.id || existing.slug === row.slug), 'Production event conflict');
  for (const thread of data.threads) assert(!current.threads.some(existing => existing.id === thread.id || (thread.article_id && existing.article_id === thread.article_id) || (thread.event_id && existing.event_id === thread.event_id)), 'Discussion conflict');
  assert.equal(current.media.length, 0, 'New image already exists');
  assert(current.users.some(user => user.id === data.actor.id && user.name === data.actor.name));
  assert(current.users.some(user => user.id === 'newsroom'));
  for (const row of data.articles) assert(!current.facebook.some(entry => entry.article_id === row.id));
  for (const update of data.updates) {
    const entries = current[update.table === 'news_articles' ? 'articles' : update.table === 'events' ? 'events' : 'threads'];
    assert.deepEqual(entries.find(row => row.id === update.before.id), update.before, 'Production update target changed');
  }
}
function verifyRows(current, data) {
  const newRows = { articles: data.articles, events: data.events, threads: data.threads, media: data.media };
  for (const [key, entries] of Object.entries(newRows)) for (const row of entries) {
    const actual = current[key].find(existing => existing.id === row.id);
    for (const [field, value] of Object.entries(row)) assert.equal(actual?.[field], value, key + '.' + field);
  }
  for (const update of data.updates) {
    const entries = current[update.table === 'news_articles' ? 'articles' : update.table === 'events' ? 'events' : 'threads'];
    assert.deepEqual(entries.find(row => row.id === update.before.id), { ...update.before, ...update.fields });
  }
}
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function verifyLive(data) {
  const checked = [];
  for (const [kind, entries] of [['news', articles], ['events', events]]) for (const row of entries) {
    const url = 'https://firelandscurrent.com/' + kind + '/' + row.slug;
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, url);
    const html = await response.text();
    assert(html.includes(escape(row.headline ?? row.title)), url + ': title');
    assert(html.includes(escape(row.summary)), url + ': summary');
    const discussion = data.threads.find(thread => thread.article_id === row.id || thread.event_id === row.id)
      ?? data.updates.find(update => update.table === 'forum_threads' && (update.before.article_id === row.id || update.before.event_id === row.id))?.before;
    assert(discussion && html.includes('/talk/' + discussion.id), url + ': discussion');
    if (kind === 'news') {
      assert(html.includes('/profile/' + row.author_id), url + ': account byline');
      assert(html.includes('property="og:image"'), url + ': social preview');
      const photo = reviewed.images.find(photo => photo.record.id === row.lead_media_id);
      if (photo) assert(html.includes('/media/' + photo.record.object_key) && html.includes(escape(photo.record.caption)) && html.includes(photo.license_url));
    }
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
  assert(!existsSync(dir + 'production-content.json'), 'Preserve prepared production package.');
  const before = inspect();
  const data = { actor: reviewed.actor, articles: reviewed.articles, events: [...reviewed.events], threads: [...reviewed.threads], media: reviewed.images.map(photo => photo.record), audit: [], updates: [] };
  for (const update of [paradeArticle, paradeEvent]) {
    const tableRows = before[update.table === 'news_articles' ? 'articles' : 'events'];
    const remote = tableRows.find(row => row.id === update.before.id);
    const localThreadUpdate = reviewed.updates.find(entry => entry.table === 'forum_threads' && entry.before[update.table === 'events' ? 'event_id' : 'article_id'] === update.before.id);
    assert(localThreadUpdate);
    if (!remote) {
      assert.equal(update.table, 'events', 'Parade story missing in production');
      data.events.push(update.after); data.threads.push(localThreadUpdate.after);
      continue;
    }
    const fields = Object.fromEntries(Object.entries(update.after).filter(([key, value]) => value !== update.before[key]));
    for (const key of Object.keys(fields)) assert.equal(remote[key], update.before[key], 'Parade field changed: ' + key);
    data.updates.push({ table: update.table, before: remote, fields });
    const remoteThread = before.threads.find(row => row[update.table === 'events' ? 'event_id' : 'article_id'] === remote.id);
    assert(remoteThread && remoteThread.title === localThreadUpdate.before.title && remoteThread.body === localThreadUpdate.before.body);
    data.updates.push({ table: 'forum_threads', before: remoteThread, fields: { title: localThreadUpdate.after.title, body: localThreadUpdate.after.body, updated_at: localThreadUpdate.after.updated_at } });
  }
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  try {
    assert.deepEqual(await proxy.env.DB.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first(), reviewed.actor);
    for (const [table, entries] of [['news_articles', articles], ['events', events]]) for (const row of entries) {
      const local = await proxy.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(row.id).first();
      for (const [field, value] of Object.entries(row)) assert.equal(local[field], value);
    }
    mkdirSync(dir + 'production-images', { recursive: true });
    for (const photo of reviewed.images) {
      const object = await proxy.env.MEDIA.get(photo.record.object_key); assert(object);
      const bytes = new Uint8Array(await object.arrayBuffer()); assert.equal(hash(bytes), photo.stored_sha256);
      writeFileSync(dir + 'production-images/' + photo.record.id + '.jpg', bytes);
    }
    data.audit = (await proxy.env.DB.prepare(`SELECT * FROM admin_audit_log WHERE action='media-upload' AND target_media_id IN (${ids(data.media)})`).all()).results;
    assert.equal(data.audit.length, 1);
  } finally { await proxy.dispose(); }
  checkBefore(before, data);
  save('production-before.json', before); save('production-content.json', data);
  const now = Date.now();
  const sql = [...data.media.map(row => insert('media', row)), ...data.audit.map(row => insert('admin_audit_log', row)),
    ...data.articles.map(row => insert('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insert('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.events.map(row => insert('events', row)), ...data.threads.map(row => insert('forum_threads', row)),
    ...data.updates.map(updateSQL), `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`];
  writeFileSync(dir + 'sync-production.sql', sql.join('\n') + '\n');
  console.log(JSON.stringify({ prepared_stories: data.articles.length, prepared_events: data.events.length, prepared_discussions: data.threads.length, updates: data.updates.length, images: data.media.length }));
} else {
  const data = read('production-content.json');
  if (mode === '--publish') {
    const current = inspect();
    if (!current.articles.some(row => row.id === data.articles[0].id)) {
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
    for (const article of data.articles) {
      const ledger = after.facebook.find(row => row.article_id === article.id);
      assert(ledger?.status === 'review' && ledger.attempts === 0 && !ledger.post_id);
    }
    save('production-publication.json', { published_at: new Date().toISOString(), counts: after.counts, live: await verifyLive(data) });
    console.log('Three stories, selected events, parade updates and image verified live. Facebook remains held until --queue.');
  } else if (mode === '--queue') {
    assert(existsSync(dir + 'production-publication.json'));
    const current = inspect(); verifyRows(current, data);
    const sql = [], now = Date.now();
    for (const article of data.articles) {
      const ledger = current.facebook.find(row => row.article_id === article.id); assert(ledger);
      if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
      assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id, 'Attempted delivery must not be retried blindly');
      sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_label,action,detail,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},headline,'facebook_queue',${q('Story ' + article.id + ': publisher authorized first-time delivery after live story and image verification.')},${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
    }
    if (sql.length) {
      writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
      cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']);
    }
    const after = inspect();
    assert.equal(after.queue_audits.length, 3);
    assert(data.articles.every(article => after.facebook.some(row => row.article_id === article.id && ['pending', 'posting', 'posted'].includes(row.status))));
    save('production-facebook-queue.json', { queued_at: new Date().toISOString(), facebook: after.facebook, queue_audits: after.queue_audits });
    console.log(JSON.stringify(after.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error })), null, 2));
  } else {
    const after = inspect(); verifyRows(after, data);
    const before = read('production-before.json');
    for (const [key, n] of [['stories', data.articles.length], ['events', data.events.length], ['discussions', data.threads.length], ['images', data.media.length]]) assert.equal(after.counts[0][key], before.counts[0][key] + n);
    assert.equal(after.queue_audits.length, 3);
    const oldLedger = before.facebook.find(row => row.article_id === paradeArticle.after.id);
    assert.deepEqual(after.facebook.find(row => row.article_id === paradeArticle.after.id), oldLedger, 'Existing parade Facebook post changed');
    const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
    try {
      const sections = (await proxy.env.DB.prepare("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
      assert.deepEqual(after.sections, sections);
    } finally { await proxy.dispose(); }
    const report = { checked_at: new Date().toISOString(), counts: after.counts[0], sections_match_local: true, facebook: after.facebook, facebook_health: after.health, queue_audits: after.queue_audits, live: await verifyLive(data) };
    save('production-verification.json', report);
    console.log(JSON.stringify({ ...report, live: report.live.length }, null, 2));
  }
}
