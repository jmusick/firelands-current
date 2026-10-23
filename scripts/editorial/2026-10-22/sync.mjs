import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3);
const dir = editorialDirectory('2026-10-22');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reviewed = read('local-import.json');
const articles = reviewed.articles, events = reviewed.events, threads = reviewed.threads;
const updatedArticles = reviewed.updates.map(change => change.after);
const allArticles = [...articles, ...updatedArticles];
assert.equal(articles.length, 3); assert.equal(events.length, 5); assert.equal(threads.length, 8); assert.equal(reviewed.images.length, 0);
assert.equal(reviewed.updates.length, 1); assert(reviewed.updates.every(change => change.table === 'news_articles'));
assert(allArticles.every(row => row.lead_media_id === null));
assert.equal(hash(readFileSync(dir + 'research.json')), reviewed.research_sha256, 'Reviewed packet changed');
const q = value => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') { assert(Number.isFinite(value)); return String(value); }
  assert.equal(typeof value, 'string');
  return "'" + value.replaceAll("'", "''") + "'";
};
const ids = rows => rows.map(row => q(row.id)).join(',');
const targetRows = [...allArticles, ...events];
function cli(args) {
  try {
    return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error('Wrangler failed: ' + (error.stdout || error.stderr || error.message));
  }
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const result = JSON.parse(output.slice(output.indexOf('[')));
  assert(result.every(row => row.success));
  return result.map(row => row.results);
}
function inspect() {
  const names = ['articles', 'events', 'threads', 'media', 'facebook', 'users', 'counts', 'sections', 'health', 'audits', 'migrations', 'features', 'updated_facebook'];
  const result = query(`
    SELECT * FROM news_articles WHERE id IN (${ids(allArticles)}) OR slug IN (${allArticles.map(row => q(row.slug)).join(',')}) ORDER BY id;
    SELECT * FROM events WHERE id IN (${ids(events)}) OR slug IN (${events.map(row => q(row.slug)).join(',')}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${ids(allArticles)}) OR event_id IN (${ids(events)}) OR id IN (${ids(threads)}) ORDER BY id;
    SELECT id FROM media WHERE 0;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids(articles)}) ORDER BY article_id;
    SELECT id,name FROM user WHERE email='jd@orboro.net' OR id='newsroom' ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) AS stories,(SELECT COUNT(*) FROM events) AS events,(SELECT COUNT(*) FROM forum_threads) AS discussions,(SELECT COUNT(*) FROM media) AS images;
    SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;
    SELECT * FROM admin_audit_log WHERE target_id IN (${ids(targetRows)}) ORDER BY id;
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT id FROM news_articles WHERE featured=1 ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids(updatedArticles)}) ORDER BY article_id;
  `);
  return Object.fromEntries(names.map((name, index) => [name, result[index]]));
}
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
}
function checkBefore(current, data) {
  for (const row of data.articles) assert(!current.articles.some(item => item.id === row.id || item.slug === row.slug), 'Production story ID/slug exists; inspect before retrying');
  assert.equal(current.events.length, 0, 'Production event ID/slug exists; inspect before retrying');
  for (const row of data.threads) assert(!current.threads.some(item => item.id === row.id || (row.article_id && item.article_id === row.article_id) || (row.event_id && item.event_id === row.event_id)), 'Discussion conflict');
  assert.equal(current.facebook.length, 0, 'New-story Facebook delivery already exists');
  for (const row of data.audits) assert(!current.audits.some(item => item.id === row.id), 'Publication audit already exists');
  assert(current.users.some(row => row.id === data.actor.id && row.name === data.actor.name), 'Production author differs');
  assert(current.users.some(row => row.id === 'newsroom'), 'Discussion author missing');
  for (const change of data.updates) assert.deepEqual(current.articles.find(row => row.id === change.before.id), change.before, 'Update target changed after preparation');
}
function verifyRows(current, data) {
  assert.equal(current.articles.length, data.articles.length + data.updates.length);
  assert.equal(current.events.length, data.events.length);
  for (const [table, rows] of Object.entries({ articles: data.articles, events: data.events, threads: data.threads })) {
    for (const row of rows) for (const [field, value] of Object.entries(row)) {
      assert.equal(current[table].find(item => item.id === row.id)?.[field], value, table + '.' + field);
    }
  }
  for (const change of data.updates) assert.deepEqual(current.articles.find(row => row.id === change.before.id), { ...change.before, ...change.fields });
  for (const row of data.audits) assert.deepEqual(current.audits.find(item => item.id === row.id), row, 'Publication audit differs');
  assert(data.articles.every(row => row.featured === 0));
  const before = read('production-before.json');
  assert.deepEqual(current.features, before.features, 'Feature selections changed');
  assert.deepEqual(current.updated_facebook, before.updated_facebook, 'Existing updated-story delivery changed');
  for (const oldThread of before.threads) assert.deepEqual(current.threads.find(row => row.id === oldThread.id), oldThread, 'Existing discussion changed');
}
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function verifyLive(data) {
  const checked = [];
  for (const [kind, rows] of [['news', [...data.articles, ...data.updates.map(change => ({ ...change.before, ...change.fields }))]], ['events', data.events]]) for (const row of rows) {
    const url = `https://firelandscurrent.com/${kind}/${row.slug}`;
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, url);
    const html = await response.text();
    assert(html.includes(escape(row.headline ?? row.title)) && html.includes(escape(row.summary)), 'Title/summary: ' + url);
    const thread = [...data.threads, ...read('production-before.json').threads].find(item => item.article_id === row.id || item.event_id === row.id);
    assert(thread, 'Discussion missing: ' + url);
    assert(html.includes('/talk/' + thread.id), 'Discussion link: ' + url);
    if (kind === 'news') {
      assert(html.includes('/profile/' + row.author_id), 'Byline profile: ' + url);
      assert(html.includes('property="og:image"'), 'Social preview: ' + url);
    } else {
      const calendar = await fetch(url + '.ics', { signal: AbortSignal.timeout(20000) });
      assert.equal(calendar.status, 200, 'Calendar export: ' + url);
      assert((await calendar.text()).includes('BEGIN:VEVENT'), 'Calendar data: ' + url);
    }
    checked.push({ url, status: response.status });
  }
  return checked;
}

if (mode === '--prepare') {
  assert(!existsSync(dir + 'production-content.json'), 'Preparation exists; preserve it and inspect before retrying');
  const before = inspect();
  const data = { actor: reviewed.actor, articles, events, threads, media: [], audits: [], updates: [],
    local_import_sha256: hash(readFileSync(dir + 'local-import.json')), prepared_at: new Date().toISOString() };
  for (const localChange of reviewed.updates) {
    const remote = before.articles.find(row => row.id === localChange.before.id);
    assert(remote && remote.slug === localChange.before.slug, 'Production update target missing');
    for (const field of ['headline', 'summary', 'body']) assert.equal(remote[field].replaceAll('\r\n', '\n'), localChange.before[field].replaceAll('\r\n', '\n'), 'Production baseline changed: ' + field);
    assert(before.threads.some(row => row.article_id === remote.id), 'Existing discussion missing');
    data.updates.push({ table: 'news_articles', before: remote, fields: localChange.fields });
  }
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  try {
    assert.deepEqual(await proxy.env.DB.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first(), data.actor);
    for (const [table, rows] of [['news_articles', allArticles], ['events', events], ['forum_threads', threads]]) for (const row of rows) {
      const actual = await proxy.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(row.id).first();
      for (const [field, value] of Object.entries(row)) assert.equal(actual?.[field], value, 'Local ' + table + '.' + field);
    }
    const migrations = (await proxy.env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results;
    assert.deepEqual(before.migrations.map(row => row.name).sort(), migrations.map(row => row.name).sort(), 'Required schema must match before sync');
    data.audits = (await proxy.env.DB.prepare(`SELECT * FROM admin_audit_log WHERE target_id IN (${targetRows.map(() => '?').join(',')}) ORDER BY id`).bind(...targetRows.map(row => row.id)).all()).results;
    const oldAuditIds = new Set(read('local-before.json').admin_audit_log.map(row => row.id));
    data.audits = data.audits.filter(row => !oldAuditIds.has(row.id));
    assert.equal(data.audits.length, 17);
    data.local_sections = (await proxy.env.DB.prepare("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
  } finally { await proxy.dispose(); }
  checkBefore(before, data);
  const now = Date.now();
  // Hold new stories for review until their live pages and previews are verified.
  const sql = [...data.articles.map(row => insert('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insert('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.events.map(row => insert('events', row)), ...data.threads.map(row => insert('forum_threads', row)),
    ...data.updates.map(change => `UPDATE news_articles SET ${Object.entries(change.fields).map(([field, value]) => field + '=' + q(value)).join(',')} WHERE id=${q(change.before.id)} AND updated_at=${change.before.updated_at};`),
    ...data.audits.map(row => insert('admin_audit_log', row)), `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`].join('\n') + '\n';
  data.sql_sha256 = hash(sql);
  save('production-before.json', before); save('production-content.json', data);
  writeFileSync(dir + 'sync-production.sql', sql);
  console.log(JSON.stringify({ prepared_stories: articles.length, prepared_events: events.length, discussions: threads.length, images: 0, uploads: 0, existing_updates: 1, audits: data.audits.length, migrations_match: true, production_before: before.counts[0] }));
} else {
  const data = read('production-content.json');
  assert.equal(hash(readFileSync(dir + 'local-import.json')), data.local_import_sha256, 'Local import changed after preparation');
  if (mode === '--publish') {
    let current = inspect();
    if (!current.articles.some(row => row.id === articles[0].id)) {
      checkBefore(current, data);
      assert.equal(hash(readFileSync(dir + 'sync-production.sql')), data.sql_sha256, 'Prepared SQL changed');
      save('production-write-intent.json', { started_at: new Date().toISOString(), sql_sha256: data.sql_sha256 });
      const output = cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'sync-production.sql', '--yes']);
      writeFileSync(dir + 'evidence/production-write-output.txt', output);
      current = inspect();
    }
    verifyRows(current, data);
    assert(current.facebook.length === 3 && current.facebook.every(row => row.status === 'review' && row.attempts === 0 && !row.post_id), 'Facebook must remain on review until queue step');
    const live = await verifyLive(data);
    save('production-publication.json', { published_at: new Date().toISOString(), counts: current.counts[0], live });
    console.log(JSON.stringify({ published_stories: 3, published_events: 5, discussions: 8, updated_stories: 1, live_checks: live.length, facebook: 'review' }));
  } else if (mode === '--queue') {
    assert(existsSync(dir + 'production-publication.json'), 'Verify publication before social delivery');
    const current = inspect(); verifyRows(current, data);
    await verifyLive(data);
    const now = Date.now(), sql = [];
    for (const article of articles) {
      const ledger = current.facebook.find(row => row.article_id === article.id); assert(ledger);
      if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
      assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id, 'Delivery attempted; inspect rather than retrying');
      sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_type,target_id,target_label,action,detail,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},'story',id,headline,'facebook_queue',${q('Story ' + article.id + ': publisher authorized first-time delivery after production content and social-preview verification.')},${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
    }
    if (sql.length) {
      writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
      save('production-queue-intent.json', { started_at: new Date(now).toISOString(), sql_sha256: hash(readFileSync(dir + 'queue-facebook.sql')) });
      const output = cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']);
      writeFileSync(dir + 'evidence/production-queue-output.txt', output);
    }
    const after = inspect();
    assert.equal(after.audits.filter(row => row.action === 'facebook_queue' && articles.some(article => article.id === row.target_id)).length, 3);
    assert(articles.every(article => after.facebook.some(row => row.article_id === article.id && ['pending', 'posting', 'posted'].includes(row.status))));
    save('production-facebook-queue.json', { queued_at: new Date().toISOString(), facebook: after.facebook });
    console.log(JSON.stringify(after.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error })), null, 2));
  } else {
    const after = inspect(); verifyRows(after, data);
    const before = read('production-before.json');
    for (const [key, delta] of [['stories', 3], ['events', 5], ['discussions', 8], ['images', 0]]) assert.equal(after.counts[0][key], before.counts[0][key] + delta, key + ' count');
    assert.deepEqual(after.sections, data.local_sections, 'Local/production section balance differs');
    assert.equal(after.audits.filter(row => row.action === 'facebook_queue' && articles.some(article => article.id === row.target_id)).length, 3);
    assert(after.facebook.length === 3 && after.facebook.every(row => ['pending', 'posting', 'posted'].includes(row.status)), 'Delivery needs attention');
    const report = { checked_at: new Date().toISOString(), counts: after.counts[0], sections_match_local: true, features_unchanged: true,
      facebook: after.facebook, publisher_health: after.health, live: await verifyLive(data) };
    save('production-verification.json', report);
    console.log(JSON.stringify({ ...report, live: report.live.length }, null, 2));
  }
}
