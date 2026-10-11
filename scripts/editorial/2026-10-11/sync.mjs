import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--prepare', '--publish', '--queue', '--verify'].includes(mode) && process.argv.length === 3,
  'Use --prepare, --publish, --queue or --verify. Production writes require publisher authorization.');
const dir = editorialDirectory('2026-10-11');
const reviewed = JSON.parse(readFileSync(dir + 'import.json', 'utf8'));
const retiredSlugs = ['lakeside-marblehead-lighthouse-festival-october-10-2026', 'saints-peter-paul-church-roof-closure-october-2026'];
const wrangler = ['node_modules/wrangler/bin/wrangler.js'];
const bucket = 'firelands-current-media';
const origin = 'https://firelandscurrent.com';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const q = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
const ids = rows => rows.map(row => q(row.id)).join(',');
const tables = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
function cli(args) {
  return execFileSync(process.execPath, [...wrangler, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}
function query(sql) {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const results = JSON.parse(output.slice(output.indexOf('[')));
  assert(results.every(result => result.success), 'D1 query failed');
  return results;
}
function remoteSnapshot() {
  const results = query(tables.map(table => `SELECT * FROM ${table};`).join('\n'));
  return Object.fromEntries(tables.map((table, index) => [table, results[index].results]));
}
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
}
function clearConflicts(before, data) {
  for (const [table, rows] of [['news_articles', data.articles], ['events', data.events], ['media', data.media], ['forum_threads', data.threads]]) {
    for (const row of rows) {
      assert(!before[table].some(existing => existing.id === row.id || (row.slug && existing.slug === row.slug) ||
        (row.object_key && existing.object_key === row.object_key) || (row.article_id && existing.article_id === row.article_id) ||
        (row.event_id && existing.event_id === row.event_id)), `Production conflict: ${table} ${row.id}`);
    }
  }
  for (const row of data.articles) assert(!before.facebook_posts.some(existing => existing.article_id === row.id));
  for (const row of data.audit) assert(!before.admin_audit_log.some(existing => existing.id === row.id));
}
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function verifyLive(data) {
  const checked = [];
  for (const [kind, rows] of [['news', data.articles], ['events', data.events]]) {
    for (const row of rows) {
      const url = `${origin}/${kind}/${row.slug}`;
      const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
      assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(html.includes(escapeHtml(row.summary)), `${url}: summary`);
      const discussion = data.threads.find(thread => thread.article_id === row.id || thread.event_id === row.id);
      assert(html.includes(`/talk/${discussion.id}`), `${url}: discussion`);
      if (kind === 'news') {
        assert(html.includes(`/profile/${row.author_id}`), `${url}: byline`);
        const image = reviewed.images.find(item => item.key === JSON.parse(readFileSync(dir + 'package.json', 'utf8')).articles.find(article => article.id === row.id || article.slug === row.slug).image);
        assert(html.includes(`/media/${image.record.object_key}`), `${url}: photo`);
        assert(html.includes(escapeHtml(image.caption)), `${url}: file-photo caption`);
        assert(html.includes(image.license_url), `${url}: license`);
        if (row.lead_media_id) assert(html.includes(`property="og:image"`), `${url}: Facebook preview`);
      }
      checked.push({ url, status: response.status });
    }
  }
  for (const image of reviewed.images) {
    const url = `${origin}/media/${image.record.object_key}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), image.stored_sha256, `${url}: checksum`);
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
function verifyRows(after, data) {
  for (const [table, rows] of [['news_articles', data.articles], ['events', data.events], ['forum_threads', data.threads], ['media', data.media]]) {
    for (const row of rows) {
      const actual = after[table].find(existing => existing.id === row.id);
      assert(actual, `${table}: missing ${row.id}`);
      for (const [key, value] of Object.entries(row)) assert.equal(actual[key], value, `${table}.${key}`);
    }
  }
  for (const audit of data.audit) assert.deepEqual(after.admin_audit_log.find(row => row.id === audit.id), audit);
  const before = JSON.parse(readFileSync(dir + 'production-before.json', 'utf8'));
  const additions = { news_articles: data.articles.length, events: data.events.length, forum_threads: data.threads.length, media: data.media.length };
  for (const [table, count] of Object.entries(additions)) {
    assert.equal(after[table].length, before[table].length + count, `${table}: count`);
    for (const row of before[table]) {
      const expected = table === 'news_articles' ? data.featureChanges.find(change => change.before.id === row.id)?.after ?? row : row;
      assert.deepEqual(after[table].find(current => current.id === row.id), expected, `Existing ${table} row changed unexpectedly`);
    }
  }
}

if (mode === '--prepare') {
  assert(!readFileSync(dir + 'review.md', 'utf8').includes('HTTP and visual review pending'), 'Local review must be complete');
  const before = remoteSnapshot();
  const featureChanges = retiredSlugs.map(slug => {
    const row = before.news_articles.find(article => article.slug === slug);
    assert(row && row.featured === 1, `Featured story absent: ${slug}`);
    return { before: row, after: { ...row, featured: 0, updated_at: Date.now() } };
  });
  save('production-before.json', before);
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  let data;
  try {
    const actor = await proxy.env.DB.prepare('SELECT id,name FROM "user" WHERE email = ?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD');
    const remoteActor = query('SELECT id,name FROM "user" WHERE email=\'jd@orboro.net\'; SELECT id FROM "user" WHERE id=\'newsroom\';');
    assert.deepEqual(remoteActor[0].results, [actor]);
    assert.equal(remoteActor[1].results.length, 1);
    const statements = [];
    const localFeatureChanges = [];
    for (const change of featureChanges) {
      const current = await proxy.env.DB.prepare('SELECT * FROM news_articles WHERE id = ?').bind(change.before.id).first();
      assert(current && current.featured === 1, 'Local featured rotation differs');
      localFeatureChanges.push({ before: current, after: { ...current, featured: 0, updated_at: change.after.updated_at } });
      statements.push(proxy.env.DB.prepare('UPDATE news_articles SET featured = 0, updated_at = ? WHERE id = ? AND featured = 1')
        .bind(change.after.updated_at, current.id));
    }
    for (const article of reviewed.articles) {
      const current = await proxy.env.DB.prepare('SELECT * FROM news_articles WHERE id = ?').bind(article.id).first();
      for (const [key, value] of Object.entries(article)) assert.equal(current[key], value, `Reviewed local story changed: ${key}`);
      const featured = article.lead_media_id ? 1 : 0;
      if (article.featured !== featured) {
        article.featured = featured;
        article.updated_at = Date.now();
        statements.push(proxy.env.DB.prepare('UPDATE news_articles SET featured = ?, updated_at = ? WHERE id = ?').bind(featured, article.updated_at, article.id));
      }
    }
    if (statements.length) {
      const results = await proxy.env.DB.batch(statements);
      assert(results.every(result => result.success && result.meta.changes === 1));
      save('import.json', reviewed);
    }
    save('featured-rotation.json', { local: localFeatureChanges, production: featureChanges });
    const [articles, events, threads, media, audit] = await Promise.all([
      proxy.env.DB.prepare(`SELECT * FROM news_articles WHERE id IN (${ids(reviewed.articles)})`).all(),
      proxy.env.DB.prepare(`SELECT * FROM events WHERE id IN (${ids(reviewed.events)})`).all(),
      proxy.env.DB.prepare(`SELECT * FROM forum_threads WHERE id IN (${ids(reviewed.threads)})`).all(),
      proxy.env.DB.prepare(`SELECT * FROM media WHERE id IN (${ids(reviewed.images.map(image => image.record))})`).all(),
      proxy.env.DB.prepare(`SELECT * FROM admin_audit_log WHERE target_media_id IN (${ids(reviewed.images.map(image => image.record))}) AND action='media-upload'`).all(),
    ]);
    data = { articles: articles.results, events: events.results, threads: threads.results, media: media.results, audit: audit.results, actor, featureChanges };
    assert.deepEqual([data.articles.length, data.events.length, data.threads.length, data.media.length, data.audit.length], [3, 7, 10, 2, 2]);
    for (const [rows, entries] of [[data.events, reviewed.events], [data.threads, reviewed.threads], [data.media, reviewed.images.map(image => image.record)]]) {
      for (const entry of entries) {
        const row = rows.find(row => row.id === entry.id);
        for (const [key, value] of Object.entries(entry)) assert.equal(row[key], value, `Reviewed local row changed: ${key}`);
      }
    }
    mkdirSync(dir + 'production-images', { recursive: true });
    for (const image of reviewed.images) {
      const object = await proxy.env.MEDIA.get(image.record.object_key);
      assert(object);
      const bytes = new Uint8Array(await object.arrayBuffer());
      assert.equal(hash(bytes), image.stored_sha256);
      writeFileSync(dir + 'production-images/' + image.record.id + '.jpg', bytes);
    }
  } finally { await proxy.dispose(); }
  clearConflicts(before, data);
  save('production-content.json', data);
  const now = Date.now();
  const sql = [
    ...data.featureChanges.map(change => `UPDATE news_articles SET featured=0,updated_at=${change.after.updated_at} WHERE id=${q(change.before.id)} AND featured=1;`),
    ...data.media.map(row => insert('media', row)), ...data.audit.map(row => insert('admin_audit_log', row)),
    ...data.articles.map(row => insert('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insert('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.events.map(row => insert('events', row)), ...data.threads.map(row => insert('forum_threads', row)),
    `UPDATE news_articles SET status='published' WHERE id IN (${ids(data.articles)});`,
  ];
  writeFileSync(dir + 'sync-production.sql', sql.join('\n') + '\n');
  console.log('Prepared 3 stories, 2 photos, 7 events and 10 discussions; JD accounts match, production conflicts absent. Three new stories featured; two older stories leave the rotation.');
} else {
  const data = JSON.parse(readFileSync(dir + 'production-content.json', 'utf8'));
  if (mode === '--publish') {
    const current = remoteSnapshot();
    clearConflicts(current, data);
    for (const change of data.featureChanges) assert.deepEqual(current.news_articles.find(row => row.id === change.before.id), change.before, 'Featured story changed since preparation');
    for (const image of reviewed.images) {
      const file = dir + 'production-images/' + image.record.id + '.jpg';
      assert.equal(hash(readFileSync(file)), image.stored_sha256);
      console.log(`Uploading ${image.filename} to production R2`);
      cli(['r2', 'object', 'put', `${bucket}/${image.record.object_key}`, '--remote', '--file', file, '--content-type', image.record.content_type]);
      const fetched = dir + 'production-images/verified-' + image.record.id + '.jpg';
      cli(['r2', 'object', 'get', `${bucket}/${image.record.object_key}`, '--remote', '--file', fetched]);
      assert.equal(hash(readFileSync(fetched)), image.stored_sha256);
    }
    cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'sync-production.sql', '--yes']);
    const after = remoteSnapshot();
    verifyRows(after, data);
    for (const row of data.articles) assert.equal(after.facebook_posts.find(entry => entry.article_id === row.id).status, 'review');
    const live = await verifyLive(data);
    save('production-publication.json', { published_at: new Date().toISOString(), target: origin, counts: { articles: 3, media: 2, events: 7, discussions: 10 }, featured: data.articles.filter(row => row.featured === 1).map(row => row.slug), retired: retiredSlugs, live });
    console.log('Production stories, photos, events and discussions match local; live pages and photo checksums verified. Facebook held until explicit queue step.');
  } else if (mode === '--queue') {
    const after = remoteSnapshot();
    verifyRows(after, data);
    const now = Date.now();
    const sql = [];
    for (const article of data.articles) {
      const ledger = after.facebook_posts.find(row => row.article_id === article.id);
      assert(ledger && ledger.status === 'review' && ledger.attempts === 0 && ledger.post_id === null, 'Only newly published, unattempted stories can be queued by this utility.');
      sql.push(`UPDATE facebook_posts SET status='pending', attempts=0, next_attempt_at=${now}, last_error=NULL, claim_id=NULL, updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
      sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_label,action,detail,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},headline,'facebook_queue',${q(`Story ${article.id}: publisher authorized first-time Facebook delivery after production page and image verification.`)},${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
    }
    writeFileSync(dir + 'queue-facebook.sql', sql.join('\n') + '\n');
    cli(['d1', 'execute', 'DB', '--remote', '--file', dir + 'queue-facebook.sql', '--yes']);
    const ledger = query(`SELECT article_id,status,attempts,post_id,last_error FROM facebook_posts WHERE article_id IN (${ids(data.articles)});`)[0].results;
    assert.equal(ledger.length, 3);
    assert(ledger.every(row => ['pending', 'posting', 'posted'].includes(row.status)));
    save('production-facebook-queue.json', { queued_at: new Date().toISOString(), ledger });
    console.log(JSON.stringify({ facebook: ledger }, null, 2));
  } else {
    const after = remoteSnapshot();
    verifyRows(after, data);
    const ledger = after.facebook_posts.filter(row => data.articles.some(article => article.id === row.article_id));
    assert.equal(ledger.length, 3);
    assert(ledger.every(row => ['pending', 'posting', 'posted'].includes(row.status)));
    const actions = after.admin_audit_log.filter(row => row.action === 'facebook_queue' && data.articles.some(article => row.detail?.startsWith(`Story ${article.id}:`)));
    assert.equal(actions.length, 3);
    const local = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
    let sections, eventStatuses;
    try {
      const localSections = (await local.env.DB.prepare("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
      const localEvents = (await local.env.DB.prepare('SELECT status,COUNT(*) AS n FROM events GROUP BY status ORDER BY status').all()).results;
      const remoteCounts = query("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section; SELECT status,COUNT(*) AS n FROM events GROUP BY status ORDER BY status;");
      sections = remoteCounts[0].results;
      eventStatuses = remoteCounts[1].results;
      assert.deepEqual(sections, localSections);
      assert.deepEqual(eventStatuses, localEvents);
    } finally { await local.dispose(); }
    const live = await verifyLive(data);
    const health = query('SELECT * FROM facebook_publisher_health WHERE id=1;')[0].results[0];
    save('production-verification.json', { verified_at: new Date().toISOString(), target: origin, content_matches_local: true,
      existing_content_preserved: true, featured_rotation: data.featureChanges, sections, eventStatuses, featured: data.articles.filter(row => row.featured === 1).map(row => row.slug), facebook: ledger, facebook_health: health, queue_audits: actions, live });
    console.log(JSON.stringify({ content_matches_local: true, articles: 3, images: 2, events: 7, discussions: 10, facebook: ledger, health }, null, 2));
  }
}
