// --prepare, --publish, --queue and --verify: carry a locally reviewed packet to a target (production, or a
// rehearsal copy). Each step re-reads the local journal, refuses to run again over its own journal, and
// checks hashes before it writes. Facebook deliveries stay in review until the live pages are verified.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkImages, checkPages } from './http.mjs';
import { checkWindow, checkLocalState, retainedLeadImages } from './local-modes.mjs';
import { assertUnchanged, baselineHash } from './manifest.mjs';
import { hash, idList, insertSql, normalizeText, q, updateSql, valueList } from './util.mjs';

const TIMESTAMPS = ['created_at', 'published_at', 'updated_at'];
const sortById = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function scope(data) {
  const changedNews = data.changed.filter(change => change.table === 'news_articles').map(change => change.after);
  const changedEvents = data.changed.filter(change => change.table === 'events').map(change => change.after);
  const reused = data.images.filter(image => image.action === 'reuse'), uploaded = data.images.filter(image => image.action === 'upload');
  const existing = data.images.filter(image => image.action !== 'upload');
  return { changedNews, changedEvents, reused, uploaded, existing, news: [...data.articles, ...changedNews], events: [...data.events, ...changedEvents] };
}

/** One round trip of read-only queries that every production mode starts from. */
function inspect(target, data) {
  const s = scope(data);
  const names = ['articles', 'events', 'threads', 'media', 'facebook', 'users', 'counts', 'sections', 'health', 'audits', 'migrations', 'features', 'updated_facebook'];
  const everyId = [...s.news, ...s.events].map(row => row.id);
  const result = target.query(`
    SELECT * FROM news_articles WHERE id IN (${idList(s.news)}) OR slug IN (${valueList(s.news.map(row => row.slug))}) ORDER BY id;
    SELECT * FROM events WHERE id IN (${idList(s.events)}) OR slug IN (${valueList(s.events.map(row => row.slug))}) ORDER BY id;
    SELECT * FROM forum_threads WHERE article_id IN (${idList(s.news)}) OR event_id IN (${idList(s.events)}) OR id IN (${idList(data.threads)}) ORDER BY id;
    SELECT * FROM media WHERE id IN (${idList(data.images.map(image => image.record))}) OR object_key IN (${valueList(s.uploaded.map(image => image.record.object_key))}) ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${idList(data.articles)}) ORDER BY article_id;
    SELECT id,name FROM user WHERE id IN (${q(data.actor.id)},'newsroom') ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) AS stories,(SELECT COUNT(*) FROM events) AS events,(SELECT COUNT(*) FROM forum_threads) AS discussions,(SELECT COUNT(*) FROM media) AS images;
    SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section;
    SELECT last_run_at,last_success_at,last_error FROM facebook_publisher_health WHERE id=1;
    SELECT * FROM admin_audit_log WHERE id IN (${idList(data.audits)}) OR target_id IN (${valueList(everyId)}) OR target_media_id IN (${idList(s.uploaded.map(image => image.record))}) ORDER BY id;
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT id FROM news_articles WHERE featured=1 ORDER BY id;
    SELECT * FROM facebook_posts WHERE article_id IN (${idList(s.changedNews)}) ORDER BY article_id;
  `);
  return Object.fromEntries(names.map((name, index) => [name, result[index]]));
}

function checkBefore(current, data, prepared) {
  const s = scope(data);
  for (const [kind, rows] of [['articles', data.articles], ['events', data.events]]) for (const row of rows) {
    assert(!current[kind].some(item => item.id === row.id || item.slug === row.slug), 'Target already has this story or event: ' + row.slug);
  }
  for (const row of data.threads) assert(!current.threads.some(item => item.id === row.id || (row.article_id && item.article_id === row.article_id) || (row.event_id && item.event_id === row.event_id)), 'Discussion conflict');
  assert.equal(current.facebook.length, 0, 'A Facebook delivery already exists for a new story');
  for (const row of data.audits) assert(!current.audits.some(item => item.id === row.id), 'Audit entry already exists');
  assert(current.users.some(row => row.id === data.actor.id && row.name === data.actor.name), 'The author account differs on the target');
  assert(current.users.some(row => row.id === 'newsroom'), 'The discussion author is missing on the target');
  assert.deepEqual(current.media, sortById(s.existing.map(image => image.record)), 'Library photo rows on the target differ from the reviewed local rows (or an uploaded photo already exists)');
  for (const change of prepared.updates) assert.deepEqual(current[change.table === 'events' ? 'events' : 'articles'].find(row => row.id === change.before.id), change.before, 'Update target changed after preparation');
  for (const feature of prepared.features) assert.equal(current.articles.find(row => row.id === feature.id)?.featured, feature.before_featured, 'Feature selection changed after preparation');
}

function remoteVerify(current, data, prepared, baseline) {
  const s = scope(data);
  assert.deepEqual(current.media, sortById(data.images.map(image => image.record)), 'Photo rows differ from the reviewed ones');
  for (const [kind, rows] of [['articles', data.articles], ['events', data.events], ['threads', data.threads]]) {
    for (const row of rows) {
      const actual = current[kind].find(item => item.id === row.id);
      assert(actual, `${kind} missing on the target: ${row.id}`);
      for (const [field, value] of Object.entries(row)) assert.equal(actual[field], value, `${kind}.${field}`);
    }
  }
  for (const change of prepared.updates) assert.deepEqual(current[change.table === 'events' ? 'events' : 'articles'].find(row => row.id === change.before.id), change.after, 'Updated row differs: ' + change.slug);
  for (const row of data.audits) assert.deepEqual(current.audits.find(item => item.id === row.id), row, 'Audit entry differs');
  assert(data.articles.every(row => current.articles.find(item => item.id === row.id).featured === 0));
  const expectedFeatured = new Set(baseline.features.map(row => row.id));
  for (const feature of prepared.features) (feature.featured ? expectedFeatured.add(feature.id) : expectedFeatured.delete(feature.id));
  assert(sameSet(current.features.map(row => row.id), [...expectedFeatured]), 'Feature selections changed unexpectedly');
  assert.deepEqual(current.updated_facebook, baseline.updated_facebook, 'An existing updated story must not be reposted');
  for (const row of baseline.threads) assert.deepEqual(current.threads.find(item => item.id === row.id), row, 'An existing discussion changed');
  assert.equal(current.articles.length, s.news.length); assert.equal(current.events.length, s.events.length);
}

function buildSql(data, prepared, now) {
  const s = scope(data);
  return [...s.uploaded.map(image => insertSql('media', image.record)),
    ...data.articles.map(row => insertSql('news_articles', { ...row, status: 'draft' })),
    ...data.articles.map(row => insertSql('facebook_posts', { article_id: row.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
    ...data.events.map(row => insertSql('events', row)), ...data.threads.map(row => insertSql('forum_threads', row)),
    ...data.audits.map(row => insertSql('admin_audit_log', row)),
    ...prepared.updates.map(change => updateSql(change.table, change.before.id, change.fields, { column: 'updated_at', value: change.before.updated_at })),
    ...prepared.features.map(feature => updateSql('news_articles', feature.id, { featured: feature.featured ? 1 : 0 }, { column: 'featured', value: feature.before_featured })),
    data.articles.length ? `UPDATE news_articles SET status='published' WHERE status='draft' AND id IN (${idList(data.articles)});` : ''].filter(Boolean).join('\n') + '\n';
}

function liveContext(loaded, data, current, existingThreads) {
  const s = scope(data);
  const changedNewsIds = new Set(s.changedNews.map(row => row.id)), changedEventIds = new Set(s.changedEvents.map(row => row.id));
  return { manifest: loaded.manifest, articles: data.articles, events: data.events,
    updatedArticles: current.articles.filter(row => changedNewsIds.has(row.id)), updatedEvents: current.events.filter(row => changedEventIds.has(row.id)),
    threads: [...data.threads, ...existingThreads], images: data.images };
}

export async function prepare({ loaded, journal, local, target }) {
  assert(!journal.exists('production-content.json'), 'A preparation exists; preserve it and inspect before retrying');
  assert(journal.exists('evidence/local-http-verification.json'), 'Run --verify-http against the local site before preparing');
  const data = journal.read('local-import.json');
  assertUnchanged(data, loaded);
  const retained = await retainedLeadImages(data, journal.read('local-before.json'), local);
  assert.deepEqual(retained, journal.read('evidence/local-http-verification.json').retained_images ?? [], 'Retained lead photos changed since local HTTP verification');
  data.images.push(...retained);
  const s = scope(data);
  const current = inspect(target, data);
  // The local database must still hold exactly what was reviewed.
  const localState = await checkLocalState({ manifest: loaded.manifest, data, before: journal.read('local-before.json'), after: await local.snapshot() });
  const migrations = (await local.db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results;
  assert.deepEqual(migrations.map(row => row.name).sort(), current.migrations.map(row => row.name).sort(), 'The target schema differs from the local one; apply migrations first');
  const localSections = (await local.db.prepare("SELECT section,COUNT(*) AS n FROM news_articles WHERE status='published' GROUP BY section ORDER BY section").all()).results;
  const prepared = { actor: data.actor, target: { name: target.name, origin: target.origin }, local_sections: localSections, retained_images: retained, updates: [], features: [] };
  for (const update of loaded.manifest.updates) {
    const table = update.table, local_ = data.changed.find(change => change.table === table && change.after.slug === update.slug);
    const row = current[table === 'events' ? 'events' : 'articles'].find(item => item.slug === update.slug);
    assert(row && local_, 'Update target missing: ' + update.slug);
    assert.equal(baselineHash(row, Object.keys(update.fields)), update.baseline_sha256, 'The target copy of an updated page differs from the reviewed baseline: ' + update.slug);
    // Older imports have different local and production save times; everything else must agree.
    for (const [field, value] of Object.entries(local_.before)) if (!TIMESTAMPS.includes(field)) assert.equal(normalizeText(row[field]), normalizeText(value), `Local and target copies differ: ${update.slug}.${field}`);
    const fields = data.updates.find(item => item.table === table && item.slug === update.slug).fields;
    prepared.updates.push({ table, slug: update.slug, before: row, fields, after: { ...row, ...fields } });
  }
  for (const feature of loaded.manifest.features) {
    const row = current.articles.find(item => item.slug === feature.slug);
    assert(row && Boolean(row.featured) !== feature.featured, 'Feature change does not apply to the target: ' + feature.slug);
    prepared.features.push({ slug: feature.slug, id: row.id, featured: feature.featured, before_featured: row.featured });
  }
  checkBefore(current, data, prepared);
  const precheck = await checkImages(target.origin, s.existing);
  for (const image of s.uploaded) {
    assert.equal(hash(journal.readBytes(image.validated_file)), image.stored_sha256, 'The validated upload changed: ' + image.key);
  }
  const sql = buildSql(data, prepared, Date.now());
  prepared.sql_sha256 = hash(sql); prepared.local_import_sha256 = hash(journal.readBytes('local-import.json'));
  journal.create('production-content.json', prepared); journal.save('production-before.json', current);
  journal.saveText('sync-production.sql', sql); journal.save('evidence/production-image-precheck.json', precheck);
  return { target: target.name, stories: data.articles.length, events: data.events.length, discussions: data.threads.length, updates: prepared.updates.length,
    features: prepared.features.length, reused_photos: s.reused.length, uploads: s.uploaded.length, audits: data.audits.length, migrations_match: true, local_counts: localState.counts, target_before: current.counts[0] };
}

function loadStage({ loaded, journal, target }) {
  const data = journal.read('local-import.json'), prepared = journal.read('production-content.json');
  assertUnchanged(data, loaded);
  assert.equal(hash(journal.readBytes('local-import.json')), prepared.local_import_sha256, 'The local import changed after preparation');
  assert.deepEqual(prepared.target, { name: target.name, origin: target.origin }, 'Prepared target differs; never reuse rehearsal journals for production');
  data.images.push(...(prepared.retained_images ?? []));
  return { data, prepared, baseline: journal.read('production-before.json') };
}

export async function publish({ loaded, journal, target, options }) {
  checkWindow(loaded.manifest, options);
  const { data, prepared, baseline } = loadStage({ loaded, journal, target });
  const s = scope(data);
  assert.equal(hash(journal.readBytes('sync-production.sql')), prepared.sql_sha256, 'The prepared SQL changed');
  let current = inspect(target, data);
  if (!journal.exists('production-write-intent.json')) {
    checkBefore(current, data, prepared);
    await checkImages(target.origin, s.existing);
    if (s.uploaded.length) {
      assert(!journal.exists('production-upload-intent.json'), 'An upload was started before; inspect the bucket rather than retrying');
      for (const image of s.uploaded) assert.equal(hash(journal.readBytes(image.validated_file)), image.stored_sha256);
      journal.create('production-upload-intent.json', { started_at: new Date().toISOString(), uploads: s.uploaded.map(image => ({ key: image.record.object_key, sha256: image.stored_sha256 })) });
    }
    for (const image of s.uploaded) {
      journal.saveText('evidence/production-upload-output.txt', target.putObject(image.record.object_key, journal.at(image.validated_file), image.record.content_type));
    }
    journal.create('production-write-intent.json', { started_at: new Date().toISOString(), sql_sha256: prepared.sql_sha256 });
    journal.saveText('evidence/production-write-output.txt', target.executeFile(journal.at('sync-production.sql')));
  } else {
    assert.equal(journal.read('production-write-intent.json').sql_sha256, prepared.sql_sha256);
    assert(data.articles.every(row => current.articles.some(item => item.id === row.id)) && data.events.every(row => current.events.some(item => item.id === row.id)), 'A write was started without complete content; inspect before any further write');
  }
  current = inspect(target, data);
  remoteVerify(current, data, prepared, baseline);
  assert(current.facebook.length === data.articles.length && current.facebook.every(row => row.status === 'review' && row.attempts === 0 && !row.post_id), 'Facebook must stay in review until the queue step');
  const live = await checkPages(target.origin, liveContext(loaded, data, current, baseline.threads));
  journal.save('production-publication.json', { published_at: new Date().toISOString(), target: target.name, counts: current.counts[0], live });
  return { target: target.name, published_stories: data.articles.length, published_events: data.events.length, discussions: data.threads.length, updated: prepared.updates.length, uploads: s.uploaded.length, live_checks: live.length, facebook: 'review' };
}

export async function queue({ loaded, journal, target, options }) {
  checkWindow(loaded.manifest, options);
  const { data, prepared, baseline } = loadStage({ loaded, journal, target });
  assert(journal.exists('production-publication.json'), 'Verify publication before releasing Facebook deliveries');
  const current = inspect(target, data);
  remoteVerify(current, data, prepared, baseline);
  await checkPages(target.origin, liveContext(loaded, data, current, baseline.threads));
  const choice = loaded.manifest.facebook?.queue ?? 'new-stories';
  const wanted = choice === 'new-stories' ? data.articles : data.articles.filter(row => loaded.manifest.stories.some(story => story.slug === row.slug && choice.includes(story.key)));
  const now = Date.now(), sql = [];
  for (const article of wanted) {
    const ledger = current.facebook.find(row => row.article_id === article.id);
    assert(ledger, 'No Facebook ledger row for ' + article.slug);
    if (['pending', 'posting', 'posted'].includes(ledger.status)) continue;
    assert(ledger.status === 'review' && ledger.attempts === 0 && !ledger.post_id, 'A delivery was attempted; inspect rather than retrying');
    sql.push(`UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${q(article.id)} AND status='review' AND attempts=0 AND post_id IS NULL;`);
    sql.push(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_type,target_id,target_label,action,detail,outcome,created_at) SELECT ${q(randomUUID())},${q(data.actor.id)},${q(data.actor.name)},'story',id,substr(headline,1,200),'facebook_queue',${q(loaded.manifest.facebook?.queue_detail ?? 'Publisher authorized first-time delivery after production content and image verification.')},'success',${now} FROM news_articles WHERE id=${q(article.id)} AND changes()=1;`);
  }
  if (sql.length) {
    assert(!journal.exists('production-queue-intent.json'), 'A queue step was started before; inspect it rather than retrying');
    const queueSql = sql.join('\n') + '\n';
    journal.create('production-queue-intent.json', { started_at: new Date(now).toISOString(), sql_sha256: hash(queueSql) });
    journal.saveText('queue-facebook.sql', queueSql);
    journal.saveText('evidence/production-queue-output.txt', target.executeFile(journal.at('queue-facebook.sql')));
  }
  const after = inspect(target, data);
  assert(wanted.every(article => after.facebook.some(row => row.article_id === article.id && ['pending', 'posting', 'posted'].includes(row.status))), 'A delivery was not queued');
  assert(data.articles.filter(article => !wanted.includes(article)).every(article => after.facebook.some(row => row.article_id === article.id && row.status === 'review')), 'A held story left review');
  assert.equal(after.audits.filter(row => row.action === 'facebook_queue' && wanted.some(article => article.id === row.target_id)).length, wanted.length);
  journal.save('production-facebook-queue.json', { queued_at: new Date().toISOString(), target: target.name, facebook: after.facebook });
  return after.facebook.map(({ article_id, status, attempts, post_id, last_error }) => ({ article_id, status, attempts, post_id, last_error }));
}

export async function verify({ loaded, journal, target }) {
  const { data, prepared, baseline } = loadStage({ loaded, journal, target });
  const s = scope(data);
  const current = inspect(target, data);
  remoteVerify(current, data, prepared, baseline);
  const deltas = { stories: data.articles.length, events: data.events.length, discussions: data.threads.length, images: s.uploaded.length };
  for (const [key, delta] of Object.entries(deltas)) assert.equal(current.counts[0][key], baseline.counts[0][key] + delta, key + ' count');
  assert.deepEqual(current.sections, prepared.local_sections, 'Local and target section counts differ');
  const choice = loaded.manifest.facebook?.queue ?? 'new-stories';
  const queued = data.articles.filter(row => choice === 'new-stories' || loaded.manifest.stories.some(story => story.slug === row.slug && choice.includes(story.key)));
  assert.equal(current.audits.filter(row => row.action === 'facebook_queue' && queued.some(article => article.id === row.target_id)).length, queued.length, 'Queue audit count for this packet');
  assert(current.facebook.every(row => queued.some(article => article.id === row.article_id) ? ['pending', 'posting', 'posted'].includes(row.status) && !row.last_error : row.status === 'review'), 'A delivery needs attention');
  const live = await checkPages(target.origin, liveContext(loaded, data, current, baseline.threads));
  const report = { checked_at: new Date().toISOString(), target: target.name, counts: current.counts[0], sections_match_local: true, features_as_planned: true, facebook: current.facebook, publisher_health: current.health, live };
  journal.save('production-verification.json', report);
  return { ...report, live: live.length };
}
