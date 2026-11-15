import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3);
const dir = editorialDirectory('2026-11-13');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const data = read('local-import.json');
assert.equal(data.research_sha256, hash(readFileSync(dir + 'research.json')));
assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()), '2026-11-13');
assert.equal(data.articles.length, 3);
const q = value => value === null ? 'NULL' : typeof value === 'number' ? (assert(Number.isFinite(value)), String(value)) : (assert.equal(typeof value, 'string'), "'" + value.replaceAll("'", "''") + "'");
const ids = data.articles.map(a => q(a.id)).join(',');
const slugs = data.articles.map(a => q(a.slug)).join(',');
const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
const cli = args => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
function query(sql) {
  const result = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const parsed = JSON.parse(result.slice(result.indexOf('[')));
  assert(parsed.every(r => r.success));
  return parsed.map(r => r.results);
}
function inspect() {
  const keys = ['articles', 'threads', 'facebook', 'users', 'migrations', 'counts', 'sections', 'features', 'audits', 'health'];
  const rows = query(`SELECT * FROM news_articles WHERE id IN (${ids}) OR slug IN (${slugs}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${ids}) ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids}) ORDER BY article_id;
    SELECT id,name FROM user WHERE email='jd@orboro.net' OR id='newsroom' ORDER BY id;
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) stories,(SELECT COUNT(*) FROM events) events,(SELECT COUNT(*) FROM forum_threads) discussions,(SELECT COUNT(*) FROM media) images;
    SELECT section,COUNT(*) n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT id FROM news_articles WHERE featured=1 ORDER BY id;
    SELECT * FROM admin_audit_log WHERE target_id IN (${ids}) ORDER BY id;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;`);
  return Object.fromEntries(keys.map((k, i) => [k, rows[i]]));
}
function verifyRows(current, prepared) {
  for (const [key, expected] of [['articles', data.articles], ['threads', data.threads], ['audits', prepared.audits]]) {
    for (const row of expected) {
      const actual = current[key].find(r => r.id === row.id);
      assert(actual, `${key} missing ${row.id}`);
      for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, `${key}.${field}`);
    }
  }
  assert.equal(current.articles.length, 3); assert.equal(current.threads.length, 3); assert.equal(current.facebook.length, 3);
  assert.deepEqual(current.features, read('production-before.json').features);
  assert.deepEqual(current.sections, prepared.sections);
  for (const [key, delta] of [['stories', 3], ['events', 0], ['discussions', 3], ['images', 0]]) assert.equal(current.counts[0][key], read('production-before.json').counts[0][key] + delta);
}
async function verifyLive() {
  const result = [];
  const esc = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  for (const a of data.articles) {
    const url = 'https://firelandscurrent.com/news/' + a.slug;
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, url);
    const html = await response.text();
    assert(html.includes(esc(a.headline)) && html.includes(esc(a.summary)));
    assert(html.includes('/profile/' + a.author_id) && html.includes('/talk/' + data.threads.find(t => t.article_id === a.id).id));
    assert(html.includes('/social-logo.png?v=2'));
    result.push({ url, status: 200, linked_JD_byline: true, discussion: true, social_preview: 'masthead' });
  }
  return result;
}
if (mode === '--prepare') {
  assert(!existsSync(dir + 'production-content.json'));
  assert(existsSync(dir + 'evidence/local-http-verification.json'));
  const current = inspect();
  assert.equal(current.articles.length, 0, 'Production already contains a selected ID or slug');
  assert.equal(current.threads.length, 0); assert.equal(current.facebook.length, 0); assert.equal(current.audits.length, 0);
  assert(current.users.some(u => u.id === data.actor.id && u.name === 'JD') && current.users.some(u => u.id === 'newsroom'));
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  let sections;
  try {
    const localMigrations = (await proxy.env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results;
    assert.deepEqual(localMigrations.map(r => r.name).sort(), current.migrations.map(r => r.name).sort(), 'Migration mismatch');
    sections = (await proxy.env.DB.prepare("SELECT section,COUNT(*) n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
  } finally { await proxy.dispose(); }
  const now = Date.now();
  const audits = data.audits.map(a => ({ ...a, detail: 'Editor authorized Nov. 13 production sync after local newsroom review; Facebook held for verified live pages', created_at: now }));
  const prepared = { local_import_sha256: hash(readFileSync(dir + 'local-import.json')), sections, audits };
  const sql = [...data.articles.map(a => insert('news_articles', { ...a, status: 'draft' })), ...data.articles.map(a => insert('facebook_posts', { article_id: a.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })), ...data.threads.map(t => insert('forum_threads', t)), ...audits.map(a => insert('admin_audit_log', a)), `UPDATE news_articles SET status='published' WHERE id IN (${ids});`].join('\n') + '\n';
  prepared.sql_sha256 = hash(sql);
  save('production-before.json', current); save('production-content.json', prepared); writeFileSync(dir + 'sync-production.sql', sql);
  console.log(JSON.stringify({ prepared: 3, migrations_match: true, production_before: current.counts[0] }));
} else {
  const prepared = read('production-content.json');
  assert.equal(hash(readFileSync(dir + 'local-import.json')), prepared.local_import_sha256);
  let current = inspect();
  if (mode === '--publish') {
    assert.equal(hash(readFileSync(dir + 'sync-production.sql')), prepared.sql_sha256);
    assert(!existsSync(dir + 'production-write-intent.json'), 'Inspect existing write intent before retry');
    assert.equal(current.articles.length, 0); assert.deepEqual(current.counts, read('production-before.json').counts);
    save('production-write-intent.json', { at: new Date().toISOString(), sql_sha256: prepared.sql_sha256 });
    writeFileSync(dir + 'evidence/production-write-output.txt', cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'sync-production.sql', '--yes']));
    current = inspect(); verifyRows(current, prepared);
    assert(current.facebook.every(r => r.status === 'review' && r.attempts === 0));
    save('production-publication.json', { checked_at: new Date().toISOString(), live: await verifyLive(), counts: current.counts[0] });
    console.log(JSON.stringify({ published: 3, live_pages_verified: 3, facebook: 'review' }));
  } else if (mode === '--queue') {
    assert(existsSync(dir + 'production-publication.json'));
    verifyRows(current, prepared);
    assert(!existsSync(dir + 'production-queue-intent.json'), 'Inspect prior queue intent before retry');
    const now = Date.now(), sql = [];
    for (const a of data.articles) {
      const ledger = current.facebook.find(r => r.article_id === a.id);
      assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id);
      sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(a.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(insert('admin_audit_log', { id: randomUUID(), actor_id: data.actor.id, actor_name: data.actor.name, target_type: 'story', target_id: a.id, target_label: a.headline.slice(0, 200), action: 'facebook_queue', detail: 'Editor authorized first-time Facebook delivery after Nov. 13 local and verified production review', outcome: 'success', created_at: now }));
    }
    writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
    save('production-queue-intent.json', { at: new Date().toISOString(), sql_sha256: hash(readFileSync(dir + 'queue-facebook.sql')) });
    writeFileSync(dir + 'evidence/production-queue-output.txt', cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']));
    current = inspect();
    assert(current.facebook.every(r => ['pending', 'posting', 'posted'].includes(r.status)));
    save('production-facebook-queue.json', { checked_at: new Date().toISOString(), facebook: current.facebook });
    console.log(JSON.stringify(current.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error }))));
  } else {
    verifyRows(current, prepared);
    assert.equal(current.audits.filter(a => a.action === 'facebook_queue').length, 3);
    assert(current.facebook.every(r => ['pending', 'posting', 'posted'].includes(r.status) && !r.last_error));
    const report = { checked_at: new Date().toISOString(), counts: current.counts[0], sections_match_local: true, featured_unchanged: true, facebook: current.facebook, publisher_health: current.health, live: await verifyLive() };
    save('production-verification.json', report);
    console.log(JSON.stringify({ counts: report.counts, live_verified: report.live.length, sections_match_local: true, facebook: current.facebook.map(({ status, attempts, post_id, last_error }) => ({ status, attempts, post_id, last_error })) }));
  }
}
