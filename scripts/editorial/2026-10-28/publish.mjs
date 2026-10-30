import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--local', '--local-http', '--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3);
const dir = editorialDirectory('2026-10-28');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, data) => writeFileSync(dir + name, JSON.stringify(data, null, 2) + '\n');
const hash = data => createHash('sha256').update(data).digest('hex');
const packetHash = hash(readFileSync(dir + 'research.json'));
const packet = read('research.json');
const tables = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
const q = value => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') { assert(Number.isFinite(value)); return String(value); }
  assert.equal(typeof value, 'string');
  return "'" + value.replaceAll("'", "''") + "'";
};
const ids = rows => rows.length ? rows.map(row => q(row.id)).join(',') : 'NULL';
const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
const update = change => `UPDATE ${change.table} SET ${Object.entries(change.fields).map(([key, value]) => key + '=' + q(value)).join(',')} WHERE id=${q(change.before.id)} AND updated_at=${change.before.updated_at};`;
const esc = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normalized = value => typeof value === 'string' ? value.replaceAll('\r\n', '\n') : value;
function audit(actor, row, type, action, detail, now) {
  return { id: randomUUID(), actor_id: actor.id, actor_name: actor.name, target_type: type, target_id: row.id,
    target_label: (row.headline ?? row.title).slice(0, 200), action, detail, outcome: 'success', created_at: now };
}
function cli(args) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const rows = JSON.parse(output.slice(output.indexOf('[')));
  assert(rows.every(row => row.success));
  return rows.map(row => row.results);
}
function checkWindow() {
  assert.equal(packet.date, '2026-10-28', 'Wrong packet date');
}
async function proxyWork(fn) {
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  try { assert.equal(proxy.env.FACEBOOK_AUTO_POST_ENABLED, 'false'); return await fn(proxy.env.DB); }
  finally { await proxy.dispose(); }
}
async function localSnapshot(db) {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results])));
}
function localVerify(before, after, data) {
  const deltas = { news_articles: 3, events: 0, forum_threads: 3, media: 0, facebook_posts: 3, admin_audit_log: 6 };
  for (const table of tables) {
    assert.equal(after[table].length, before[table].length + deltas[table], table + ' count');
    for (const row of before[table]) {
      const change = data.updates.find(item => item.table === table && item.before.id === row.id);
      assert.deepEqual(after[table].find(item => (item.id ?? item.article_id) === (row.id ?? row.article_id)), change?.after ?? row, 'Unrelated change: ' + table);
    }
  }
  for (const [table, rows] of [['news_articles', data.articles], ['events', data.events], ['forum_threads', data.threads], ['admin_audit_log', data.audits]])
    for (const row of rows) for (const [field, value] of Object.entries(row)) assert.equal(after[table].find(item => item.id === row.id)?.[field], value, table + '.' + field);
  assert(data.articles.every(row => after.facebook_posts.some(item => item.article_id === row.id && item.status === 'review' && item.attempts === 0 && !item.post_id)));
}
async function httpVerify(origin, data, existingThreads) {
  const checked = [];
  const allThreads = [...data.threads, ...existingThreads];
  for (const [kind, rows] of [['news', [...data.articles, ...data.updates.filter(c => c.table === 'news_articles').map(c => c.after)]],
    ['events', [...data.events, ...data.updates.filter(c => c.table === 'events').map(c => c.after)]]]) {
    for (const row of rows) {
      const url = `${origin}/${kind}/${row.slug}`;
      const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes(esc(row.headline ?? row.title)) && html.includes(esc(row.summary)), 'Title/summary: ' + url);
      const thread = allThreads.find(t => t.article_id === row.id || t.event_id === row.id);
      assert(thread && html.includes('/talk/' + thread.id), 'Discussion: ' + url);
      if (kind === 'news') {
        assert(html.includes('/profile/' + row.author_id) && html.includes('property="og:image"'), 'Byline/preview: ' + url);
        if (data.articles.some(a => a.id === row.id)) assert(html.includes('/social-logo.png?v=2'), 'Masthead fallback: ' + url);

      } else {
        const response = await fetch(url + '.ics', { signal: AbortSignal.timeout(20000) });
        assert.equal(response.status, 200);
        const ics = await response.text();
        assert(ics.includes('BEGIN:VEVENT') && ics.includes(row.starts_on.replaceAll('-', '')), 'Calendar: ' + url);
        if (row.start_time && !row.hours_note) {
          const offset = row.starts_on < '2026-11-01' ? '-04:00' : '-05:00';
          const utc = new Date(`${row.starts_on}T${row.start_time}:00${offset}`).toISOString().replace(/[-:]/g, '').replace('.000', '');
          assert(ics.includes('DTSTART:' + utc), 'Calendar time: ' + url);
        }
      }
      checked.push({ url, status: 200 });
    }
  }
  return checked;
}
function inspect(data) {
  const news = [...data.articles, ...data.updates.filter(c => c.table === 'news_articles').map(c => c.after)];
  const events = [...data.events, ...data.updates.filter(c => c.table === 'events').map(c => c.after)];
  const names = ['articles', 'events', 'threads', 'facebook', 'users', 'counts', 'sections', 'health', 'audits', 'migrations', 'features', 'updated_facebook'];
  const results = query(`SELECT * FROM news_articles WHERE id IN (${ids(news)}) OR slug IN (${news.map(r => q(r.slug)).join(',')}) ORDER BY id;
    SELECT * FROM events WHERE id IN (${ids(events)}) OR slug IN (${events.map(r => q(r.slug)).join(',')}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${ids(news)}) OR event_id IN (${ids(events)}) ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids(data.articles)}) ORDER BY article_id;
    SELECT id,name FROM user WHERE email='jd@orboro.net' OR id='newsroom' ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) stories,(SELECT COUNT(*) FROM events) events,(SELECT COUNT(*) FROM forum_threads) discussions,(SELECT COUNT(*) FROM media) images;
    SELECT section,COUNT(*) n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;
    SELECT * FROM admin_audit_log WHERE target_id IN (${ids([...news, ...events])}) ORDER BY id;
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT id FROM news_articles WHERE featured=1 ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${ids(news.filter(r => !data.articles.some(a => a.id === r.id)))}) ORDER BY article_id;`);
  return Object.fromEntries(names.map((name, i) => [name, results[i]]));
}
function beforeVerify(current, data) {
  for (const [kind, rows] of [['articles', data.articles], ['events', data.events]]) for (const row of rows)
    assert(!current[kind].some(item => item.id === row.id || item.slug === row.slug), 'Production duplicate: ' + row.slug);
  assert.equal(current.facebook.length, 0);
  for (const row of data.threads) assert(!current.threads.some(t => t.id === row.id));
  assert(current.users.some(u => u.id === data.actor.id && u.name === 'JD') && current.users.some(u => u.id === 'newsroom'));
  for (const change of data.updates) assert.deepEqual(current[change.table === 'events' ? 'events' : 'articles'].find(r => r.id === change.before.id), change.before, 'Update changed after preparation');
  for (const a of data.audits) assert(!current.audits.some(row => row.id === a.id));
}
function remoteVerify(current, data) {
  for (const [kind, rows] of [['articles', data.articles], ['events', data.events], ['threads', data.threads]]) for (const row of rows)
    for (const [field, value] of Object.entries(row)) assert.equal(current[kind].find(r => r.id === row.id)?.[field], value, kind + '.' + field);
  for (const change of data.updates) assert.deepEqual(current[change.table === 'events' ? 'events' : 'articles'].find(r => r.id === change.after.id), change.after);
  for (const row of data.audits) {
    const actual = current.audits.find(r => r.id === row.id); assert(actual);
    for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, 'Audit.' + field);
    for (const field of ['target_user_id', 'target_business_id', 'target_ad_id', 'target_media_id']) assert.equal(actual[field], null);
  }
  const before = read('production-before.json');
  assert.deepEqual(current.features, before.features);
  assert.deepEqual(current.updated_facebook, before.updated_facebook, 'Existing story must not be reposted');
  for (const row of before.threads) assert.deepEqual(current.threads.find(r => r.id === row.id), row);
}

if (mode === '--local') {
  checkWindow();
  assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect journals before retrying');
  await proxyWork(async db => {
    const before = await localSnapshot(db);
    const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
    assert(actor?.name === 'JD' && await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first());
    const now = Date.now();
    const data = { actor, research_sha256: packetHash, imported_at: new Date(now).toISOString(), articles: [], events: [], threads: [], audits: [], updates: [], images: [], excluded_stories: packet.stories.filter(s => s.status !== 'ready').map(s => s.slug) };
    for (const s of packet.stories.filter(s => s.status === 'ready')) {
      assert(!s.body.includes('[NEED:') && ['none', 'shoot', 'permission-needed'].includes(s.image.status));
      assert(!before.news_articles.some(row => row.slug === s.slug));
      const row = { id: randomUUID(), slug: s.slug, headline: s.headline, summary: s.summary, body: s.body, section: s.section, community: s.community, byline: actor.name, author_id: actor.id, lead_media_id: null, featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now };
      data.articles.push(row);
    }
    for (const e of packet.events.filter(e => e.status === 'ready')) {
      assert(!before.events.some(row => row.slug === e.slug));
      const row = { id: randomUUID(), slug: e.slug, title: e.title, summary: e.summary, description: e.description + `\n\n[Organizer details](${e.source_url})`, category: e.category, starts_on: e.starts_on, start_time: e.start_time, ends_on: e.ends_on, end_time: e.end_time, hours_note: e.hours_note, venue: e.venue, address: e.address, community: e.community, organizer: e.organizer, organizer_url: e.organizer_url, cost: e.cost, link: e.source_url, performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '', image_media_id: null, status: 'published', created_at: now, updated_at: now };
      data.events.push(row);
    }
    for (const [type, rows] of [['story', data.articles], ['event', data.events]]) for (const row of rows) {
      data.threads.push({ id: randomUUID(), author_id: 'newsroom', title: row.headline ?? row.title, body: row.summary, [type === 'story' ? 'article_id' : 'event_id']: row.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now });
      for (const action of ['create', 'publish']) data.audits.push(audit(actor, row, type, `${type}-${action}`, 'Publisher authorized Oct. 28 reviewed packet; local dev review', now));
    }
    assert.equal(packet.updates.length, 0);
    assert.equal(packet.events.length, 0);
    assert.equal(data.articles.length, 3); assert.equal(data.events.length, 0); assert.equal(data.updates.length, 0); assert.equal(data.audits.length, 6);
    save('local-before.json', before); save('local-import-pending.json', data);
    const sql = [...data.articles.map(r => insert('news_articles', { ...r, status: 'draft' })), ...data.articles.map(r => insert('facebook_posts', { article_id: r.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })), ...data.events.map(r => insert('events', r)), ...data.threads.map(r => insert('forum_threads', r)), ...data.updates.map(update), ...data.audits.map(r => insert('admin_audit_log', r)), `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`].join('\n');
    writeFileSync(dir + 'import-local.sql', sql);
    // Keep quoted story paragraphs inside individual prepared statements.
    const statements = [...data.articles.map(r => insert('news_articles', { ...r, status: 'draft' })), ...data.articles.map(r => insert('facebook_posts', { article_id: r.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })), ...data.events.map(r => insert('events', r)), ...data.threads.map(r => insert('forum_threads', r)), ...data.updates.map(update), ...data.audits.map(r => insert('admin_audit_log', r)), `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`];
    const result = await db.batch(statements.map(statement => db.prepare(statement)));
    save('evidence/local-write-result.json', result);
    assert(result.every(r => r.success && r.meta.changes >= 1));
    save('local-import.json', data);
    localVerify(before, await localSnapshot(db), data);
    console.log(JSON.stringify({ stories: 3, events: 0, updates: 0, audits: 6, held_stories: data.excluded_stories, facebook: 'review' }));
  });
} else {
  const data = read('local-import.json');
  assert.equal(data.research_sha256, packetHash, 'Packet changed after local import');
  if (mode === '--local-http') {
    await proxyWork(async db => {
      const after = await localSnapshot(db), before = read('local-before.json');
      localVerify(before, after, data);
      const http = await httpVerify('http://127.0.0.1:4321', data, before.forum_threads);
      save('evidence/local-http-verification.json', { checked_at: new Date().toISOString(), http, counts: Object.fromEntries(tables.map(t => [t, after[t].length])), unrelated_rows_unchanged: true });
      console.log(JSON.stringify({ verified_pages: http.length, local_facebook_disabled: true }));
    });
  } else if (mode === '--prepare') {
    assert(!existsSync(dir + 'production-content.json'));
    assert(existsSync(dir + 'evidence/local-http-verification.json'));
    const before = inspect(data), prepared = structuredClone(data);
    for (const change of prepared.updates) {
      const row = before[change.table === 'events' ? 'events' : 'articles'].find(r => r.slug === change.before.slug);
      assert(row);
      // Older imports have different local/production save times; preserve the remote dates.
      for (const [field, value] of Object.entries(change.before)) {
        if (!['created_at', 'published_at', 'updated_at'].includes(field)) assert.equal(normalized(row[field]), normalized(value), 'Local/production update mismatch: ' + field);
      }
      change.before = row; change.after = { ...row, ...change.fields };
    }
    await proxyWork(async db => {
      const migrations = (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results;
      assert.deepEqual(migrations.map(r => r.name).sort(), before.migrations.map(r => r.name).sort(), 'Migrations differ');
      localVerify(read('local-before.json'), await localSnapshot(db), data);
      prepared.local_sections = (await db.prepare("SELECT section,COUNT(*) n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
    });
    beforeVerify(before, prepared);
    const now = Date.now();
    const sql = [...prepared.articles.map(r => insert('news_articles', { ...r, status: 'draft' })), ...prepared.articles.map(r => insert('facebook_posts', { article_id: r.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })), ...prepared.events.map(r => insert('events', r)), ...prepared.threads.map(r => insert('forum_threads', r)), ...prepared.updates.map(update), ...prepared.audits.map(r => insert('admin_audit_log', r)), `UPDATE news_articles SET status='published' WHERE id IN (${ids(prepared.articles)});`].join('\n') + '\n';
    prepared.sql_sha256 = hash(sql); prepared.local_import_sha256 = hash(readFileSync(dir + 'local-import.json'));
    save('production-before.json', before); save('production-content.json', prepared); writeFileSync(dir + 'sync-production.sql', sql);
    console.log(JSON.stringify({ prepared_stories: 3, events: 0, updates: 0, migrations_match: true, production_before: before.counts[0] }));
  } else {
    const prepared = read('production-content.json');
    assert.equal(hash(readFileSync(dir + 'local-import.json')), prepared.local_import_sha256);
    let current = inspect(prepared);
    if (mode === '--publish') {
      checkWindow();
      assert.equal(hash(readFileSync(dir + 'sync-production.sql')), prepared.sql_sha256);
      if (!existsSync(dir + 'production-write-intent.json')) {
        beforeVerify(current, prepared);
        save('production-write-intent.json', { at: new Date().toISOString(), sql_sha256: prepared.sql_sha256 });
        writeFileSync(dir + 'evidence/production-write-output.txt', cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'sync-production.sql', '--yes']));
      } else {
        assert.equal(read('production-write-intent.json').sql_sha256, prepared.sql_sha256);
        assert(prepared.articles.every(a => current.articles.some(r => r.id === a.id)), 'Write intent exists without complete content; inspect before any further write');
      }
      current = inspect(prepared); remoteVerify(current, prepared);
      assert(current.facebook.every(r => r.status === 'review' && r.attempts === 0));
      const live = await httpVerify('https://firelandscurrent.com', prepared, read('production-before.json').threads);
      save('production-publication.json', { published_at: new Date().toISOString(), live, counts: current.counts[0] });
      console.log(JSON.stringify({ published_stories: 3, events: 0, updates: 0, verified_pages: live.length, facebook: 'review' }));
    } else if (mode === '--queue') {
      checkWindow(); assert(existsSync(dir + 'production-publication.json'));
      remoteVerify(current, prepared);
      const sql = [], now = Date.now();
      for (const row of prepared.articles) {
        const ledger = current.facebook.find(r => r.article_id === row.id); assert(ledger);
        if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
        assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id);
        sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(row.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
        const a = audit(prepared.actor, row, 'story', 'facebook_queue', 'Publisher authorized first-time delivery after verified Oct. 28 local and live review', now);
        sql.push(insert('admin_audit_log', a));
      }
      if (sql.length) {
        assert(!existsSync(dir + 'production-queue-intent.json'), 'Inspect queue intent before retrying');
        writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
        save('production-queue-intent.json', { at: new Date().toISOString(), sha256: hash(readFileSync(dir + 'queue-facebook.sql')) });
        writeFileSync(dir + 'evidence/production-queue-output.txt', cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']));
      }
      current = inspect(prepared);
      save('production-facebook-queue.json', { checked_at: new Date().toISOString(), facebook: current.facebook });
      assert(current.facebook.length === 3 && current.facebook.every(r => ['pending', 'posting', 'posted'].includes(r.status)));
      console.log(JSON.stringify(current.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error }))));
    } else {
      remoteVerify(current, prepared);
      for (const [field, delta] of [['stories', 3], ['events', 0], ['discussions', 3], ['images', 0]]) assert.equal(current.counts[0][field], read('production-before.json').counts[0][field] + delta);
      assert.deepEqual(current.sections, prepared.local_sections);
      assert.equal(current.audits.filter(a => a.action === 'facebook_queue' && prepared.articles.some(r => r.id === a.target_id)).length, 3);
      assert(current.facebook.every(r => ['pending', 'posting', 'posted'].includes(r.status)));
      const live = await httpVerify('https://firelandscurrent.com', prepared, read('production-before.json').threads);
      const report = { checked_at: new Date().toISOString(), counts: current.counts[0], sections_match_local: true, features_unchanged: true, facebook: current.facebook, publisher_health: current.health, live };
      save('production-verification.json', report);
      console.log(JSON.stringify({ ...report, live: live.length }));
    }
  }
}
