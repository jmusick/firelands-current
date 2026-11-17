import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { openJournal } from './editorial/lib/journal.mjs';
import { assertUnchanged, baselineHash, packetPath, validateManifest } from './editorial/lib/manifest.mjs';
import { applyLocal, checkWindow, verifyHttp, verifyLocal } from './editorial/lib/local-modes.mjs';
import { prepare, publish, queue, verify } from './editorial/lib/production-modes.mjs';
import { TABLES } from './editorial/lib/local.mjs';
import { easternToIcsUtc, hash } from './editorial/lib/util.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = () => ({ schema: 1, date: '2026-10-24', author: { email: 'editor@example.test', name: 'Editor' }, inputs: [],
  stories: [{ key: 'brief', slug: 'local-brief', section: 'local', community: 'Sandusky', headline: 'Local brief', summary: 'Local brief summary', body: 'Reviewed text.' }],
  events: [{ key: 'meeting', slug: 'local-meeting', title: 'Local meeting', summary: 'Local meeting summary', description: 'Details', category: 'meetings', starts_on: '2026-10-25', start_time: '18:00', venue: 'Town hall', community: 'Sandusky', source_url: 'https://organizer.example/' }],
  updates: [], features: [], media: [], facebook: { queue: 'new-stories' } });

function database(existing = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(new URL('../migrations/', import.meta.url)).sort();
  for (const file of migrations) sqlite.exec(read('migrations/' + file));
  sqlite.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)');
  for (const file of migrations) sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file);
  for (const id of ['editor', 'newsroom']) sqlite.prepare('INSERT OR IGNORE INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,1,1)').run(id, id === 'editor' ? 'Editor' : 'Newsroom', id + '@example.test');
  if (existing) for (const id of ['existing-update', 'existing-feature']) {
    sqlite.prepare(`INSERT INTO news_articles (id,slug,headline,summary,body,section,community,byline,author_id,status,published_at,created_at,updated_at,featured)
      VALUES (?,?,'Existing story','Old summary','Old body','local','Sandusky','Editor','editor','published',1,1,1,1)`).run(id, id);
    sqlite.prepare("INSERT INTO forum_threads (id,author_id,title,body,article_id,status,created_at,updated_at,last_activity_at) VALUES (?,'newsroom','Existing story','Old summary',?,'published',1,1,1)").run(id + '-thread', id);
    sqlite.prepare("UPDATE facebook_posts SET status='posted',post_id=? WHERE article_id=?").run(id + '-post', id);
  }
  const db = { prepare(sql) {
    const s = sqlite.prepare(sql); let values = [];
    const query = { bind(...v) { values = v; return query; }, async first() { return s.get(...values) ?? null; }, async all() { return { results: s.all(...values) }; },
      async run() { return { success: true, meta: { changes: Number(s.run(...values).changes) } }; } };
    return query;
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const binding = '__packetTest' + crypto.randomUUID().replaceAll('-', '');
  globalThis[binding] = { DB: db };
  const auditCode = ts.transpileModule(read('src/lib/audit.ts'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import .* from ['"]cloudflare:workers['"];?/, `const env = globalThis[${JSON.stringify(binding)}];`);
  return { sqlite, db, audit: () => import('data:text/javascript;base64,' + Buffer.from(auditCode).toString('base64')),
    snapshot: async () => Object.fromEntries(TABLES.map(table => [table, sqlite.prepare('SELECT * FROM ' + table).all().map(row => ({ ...row }))])),
    close() { delete globalThis[binding]; sqlite.close(); } };
}

test('manifest rejects unsafe keys, impossible dates, duplicate targets and unreviewed uploads', () => {
  validateManifest(manifest(), '2026-10-24');
  const invalid = change => { const m = manifest(); change(m); assert.throws(() => validateManifest(m, m.date)); };
  invalid(m => { m.stories[0].key = '../../outside'; });
  invalid(m => { m.events[0].starts_on = '2026-02-30'; });
  invalid(m => { m.events[0].start_time = '27:00'; });
  invalid(m => { m.events[0].ends_on = '2026-10-01'; });
  invalid(m => { m.features = [{ slug: 'old', featured: true }, { slug: 'old', featured: false }]; });
  invalid(m => { m.publish_window = { until: '2026-10-25T12:00:00' }; });
  invalid(m => { m.media = [{ key: 'photo', action: 'upload', caption: 'Caption', credit: 'Credit', alt: 'Alt', file: 'photo.jpg', source: 'Source' }]; });
  assert.throws(() => packetPath(tmpdir(), '../outside'), /leaves/);
});

test('exclusive journal claims, baseline hashes, changed copy and expired windows fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'packet-journal-'));
  try {
    const journal = openJournal('2026-10-24', dir);
    journal.create('intent.json', { original: true });
    assert.throws(() => journal.create('intent.json', { original: false }), /EEXIST/);
    assert.deepEqual(journal.read('intent.json'), { original: true });
    assert.equal(baselineHash({ body: 'a\r\nb' }, ['body']), baselineHash({ body: 'a\nb' }, ['body']));
    assert.throws(() => assertUnchanged({ manifest_sha256: 'old', inputs_sha256: {} }, { manifestSha256: 'new', inputs: {} }), /changed/);
    assert.throws(() => checkWindow({ publish_window: { until: '2000-01-01T00:00:00Z' } }), /passed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publication verifies retained lead photos without adding them to the frozen manifest or import', async () => {
  const local = database(true), remote = database(true), dir = mkdtempSync(join(tmpdir(), 'packet-flow-'));
  const photoBytes = Buffer.from('existing library photo');
  for (const fixture of [local, remote]) {
    fixture.sqlite.prepare(`INSERT INTO media (id,object_key,content_type,width,height,bytes,filename,alt,caption,credit,created_at,updated_at)
      VALUES ('retained','library/retained.jpg','image/jpeg',1200,800,?,'retained.jpg','Existing alt','Existing caption','Existing credit',1,1)`).run(photoBytes.length);
    fixture.sqlite.prepare("UPDATE news_articles SET lead_media_id='retained' WHERE id='existing-update'").run();
    fixture.sqlite.prepare(`INSERT INTO admin_audit_log (id,actor_id,actor_name,target_type,target_id,target_label,action,detail,created_at)
      VALUES ('old-queue','editor','Editor','story','existing-update','Existing story','facebook_queue','Earlier delivery',1)`).run();
  }
  local.env = { MEDIA: { get: async key => key === 'library/retained.jpg' ? { arrayBuffer: async () => photoBytes } : null } };
  const journal = openJournal('2026-10-24', dir);
  const m = manifest(), loaded = { manifest: m, manifestSha256: hash(JSON.stringify(m)), inputs: {} };
  m.updates = [{ table: 'news_articles', slug: 'existing-update', fields: { summary: 'Updated summary' }, baseline_sha256: baselineHash({ summary: 'Old summary' }, ['summary']) }];
  m.features = [{ slug: 'existing-feature', featured: false }];
  loaded.manifestSha256 = hash(JSON.stringify(m));
  const target = { name: 'rehearsal', origin: 'http://127.0.0.1:4414', writes: 0,
    query(sql) { return sql.split(';').map(s => s.trim()).filter(Boolean).map(s => remote.sqlite.prepare(s).all().map(row => ({ ...row }))); },
    executeFile(file) { this.writes++; remote.sqlite.exec(readFileSync(file, 'utf8')); return 'ok'; } };
  const originalFetch = globalThis.fetch;
  let omitPhoto = false, corruptPhoto = false;
  globalThis.fetch = async url => {
    const u = new URL(url), sql = u.port === '4414' ? remote.sqlite : local.sqlite;
    if (u.pathname === '/media/library/retained.jpg') return new Response(corruptPhoto ? 'changed photo' : photoBytes);
    const stories = sql.prepare('SELECT * FROM news_articles').all(), events = sql.prepare('SELECT * FROM events').all(), threads = sql.prepare('SELECT * FROM forum_threads').all();
    const event = events.find(e => u.pathname.endsWith(e.slug + '.ics'));
    if (event) return new Response('BEGIN:VEVENT\nDTSTART:' + easternToIcsUtc(event.starts_on, event.start_time));
    return new Response(stories.map(s => `${s.slug} ${s.headline} ${s.summary} /profile/${s.author_id} property="og:image" /social-logo.png?v=2 ${s.lead_media_id && !omitPhoto ? '/media/library/retained.jpg Existing alt Existing caption Existing credit' : ''}`).join(' ') +
      events.map(e => `${e.title} ${e.summary} ${e.link}`).join(' ') + threads.map(t => '/talk/' + t.id).join(' '));
  };
  try {
    const args = { loaded, journal, local, target, options: {} };
    await applyLocal(args);
    assert.equal(local.sqlite.prepare("SELECT status FROM facebook_posts WHERE article_id NOT LIKE 'existing-%'").get().status, 'review');
    await assert.rejects(applyLocal(args), /journal exists/);
    await verifyLocal(args);
    await assert.rejects(prepare(args), /verify-http/);
    await verifyHttp({ ...args, origin: 'http://127.0.0.1:4415' });
    assert.equal(journal.read('local-import.json').images.length, 0);
    assert.equal(m.media.length, 0);
    assert.equal(journal.read('evidence/local-http-verification.json').retained_images[0].stored_sha256, hash(photoBytes));
    omitPhoto = true;
    await assert.rejects(verifyHttp({ ...args, origin: 'http://127.0.0.1:4415' }), /Lead photo missing/);
    omitPhoto = false;
    corruptPhoto = true;
    await assert.rejects(verifyHttp({ ...args, origin: 'http://127.0.0.1:4415' }), /Image differs/);
    await assert.rejects(prepare(args), /Image differs/);
    assert.equal(target.writes, 0);
    corruptPhoto = false;
    await prepare(args);
    await assert.rejects(publish({ ...args, target: { ...target, name: 'production', origin: 'https://firelandscurrent.com' } }), /Prepared target differs/);
    await assert.rejects(queue(args), /publication/);
    const sql = journal.readBytes('sync-production.sql');
    journal.saveText('sync-production.sql', sql + '\n-- changed');
    await assert.rejects(publish(args), /SQL changed/);
    assert.equal(target.writes, 0);
    journal.saveBytes('sync-production.sql', sql);
    await publish(args);
    assert.equal(remote.sqlite.prepare("SELECT status FROM facebook_posts WHERE article_id NOT LIKE 'existing-%'").get().status, 'review');
    corruptPhoto = true;
    await assert.rejects(queue(args), /Image differs/);
    assert.equal(remote.sqlite.prepare("SELECT status FROM facebook_posts WHERE article_id NOT LIKE 'existing-%'").get().status, 'review');
    corruptPhoto = false;
    await queue(args);
    await queue(args);
    assert.equal(remote.sqlite.prepare("SELECT status FROM facebook_posts WHERE article_id NOT LIKE 'existing-%'").get().status, 'pending');
    assert.equal(remote.sqlite.prepare("SELECT summary FROM news_articles WHERE id='existing-update'").get().summary, 'Updated summary');
    assert.equal(remote.sqlite.prepare("SELECT status FROM facebook_posts WHERE article_id='existing-update'").get().status, 'posted');
    assert.equal(remote.sqlite.prepare("SELECT featured FROM news_articles WHERE id='existing-feature'").get().featured, 0);
    assert.equal(remote.sqlite.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE action='facebook_queue' AND target_id NOT LIKE 'existing-%'").get().n, 1);
    assert.equal(remote.sqlite.prepare("SELECT detail FROM admin_audit_log WHERE id='old-queue'").get().detail, 'Earlier delivery');
    await verify(args);
    remote.sqlite.prepare("DELETE FROM admin_audit_log WHERE action='facebook_queue' AND target_id NOT LIKE 'existing-%'").run();
    await assert.rejects(verify(args), /Queue audit count for this packet/);
  } finally { globalThis.fetch = originalFetch; local.close(); remote.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a validation failure after staging an upload removes its unreferenced file', async () => {
  const local = database(), dir = mkdtempSync(join(tmpdir(), 'packet-upload-'));
  const journal = openJournal('2026-10-24', dir);
  journal.packetDir = dir;
  const m = manifest(), bytes = Buffer.from('validated fixture');
  writeFileSync(join(dir, 'original.jpg'), bytes);
  m.media = [{ key: 'photo', action: 'upload', file: 'original.jpg', alt: 'Photo', caption: 'Caption', credit: 'Credit', source: 'Licensed', original_sha256: hash(bytes) }];
  m.stories[0].media = 'photo';
  m.updates = [{ table: 'news_articles', slug: 'missing-story', fields: { summary: 'Changed' }, baseline_sha256: hash('baseline') }];
  const discarded = [];
  local.media = async () => ({ checkUpload: async () => ({ bytes, ext: 'jpg' }), validateDetails: () => [],
    storeMedia: async () => ({ record: { id: 'new-photo', object_key: 'new-photo.jpg' }, statement: {} }), mediaAudit: () => ({}),
    discardUnsavedMedia: async records => discarded.push(...records) });
  try {
    await assert.rejects(applyLocal({ loaded: { manifest: m, manifestSha256: hash(JSON.stringify(m)), inputs: {} }, journal, local, options: {} }), /missing or unpublished/);
    assert.deepEqual(discarded.map(row => row.id), ['new-photo']);
    assert.equal(local.sqlite.prepare('SELECT COUNT(*) AS n FROM news_articles').get().n, 0);
    assert(journal.exists('local-import-pending.json'));
  } finally { local.close(); rmSync(dir, { recursive: true, force: true }); }
});
