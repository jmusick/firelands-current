import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-11-11') + 'fieldstone/';
const origin = 'https://firelandscurrent.com';
const save = (name, data) => writeFileSync(dir + name, JSON.stringify(data, null, 2) + '\n');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cli = args => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const q = value => value === null ? 'NULL' : typeof value === 'number' ? (assert(Number.isFinite(value)), String(value)) : "'" + String(value).replaceAll("'", "''") + "'";
const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
const query = sql => {
  const output = cli(['d1', 'execute', 'DB', '--remote', '--command', sql, '--json']);
  const results = JSON.parse(output.slice(output.indexOf('[')));
  assert(results.every(row => row.success));
  return results.map(row => row.results);
};
const write = (name, sql) => {
  assert(!existsSync(dir + name + '-intent.json'), 'Inspect existing write intent before retrying: ' + name);
  writeFileSync(dir + name + '.sql', sql);
  save(name + '-intent.json', { authorized: 'Publisher requested production sync and Facebook queue in this chat.', at: new Date().toISOString(), sha256: hash(sql) });
  writeFileSync(dir + name + '-output.txt', cli(['d1', 'execute', 'DB', '--remote', '--file', dir + name + '.sql', '--yes']));
};
async function fetchBytes(path) {
  const response = await fetch(origin + path, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  return new Uint8Array(await response.arrayBuffer());
}
const original = read('import.json');
const pdf = read('pdf-attachment.json');
assert.equal(hash(await fetchBytes(pdf.public_url)), pdf.sha256, 'Live PDF differs');

let pack;
if (existsSync(dir + 'production-package.json')) pack = read('production-package.json');
else {
  const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
  try {
    const article = await proxy.env.DB.prepare('SELECT * FROM news_articles WHERE id=?').bind(original.article.id).first();
    assert.equal(article.status, 'published'); assert(article.body.includes(pdf.public_url));
    const media = [];
    for (const photo of original.media) {
      const record = await proxy.env.DB.prepare('SELECT * FROM media WHERE id=?').bind(photo.id).first();
      const object = await proxy.env.MEDIA.get(record.object_key);
      const bytes = new Uint8Array(await object.arrayBuffer());
      assert.equal(hash(bytes), photo.sha256);
      const file = dir + record.id + '.jpg'; writeFileSync(file, bytes);
      media.push({ record, file, sha256: photo.sha256 });
    }
    const actor = await proxy.env.DB.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
    pack = { article, thread: original.thread, media, actor, deployment: 'c441de42-9f69-4b2e-9e2e-4885522f6868' };
    save('production-package.json', pack);
  } finally { await proxy.dispose(); }
}
const articleId = q(pack.article.id);
function inspect() {
  const results = query(`SELECT * FROM news_articles WHERE id=${articleId} OR slug=${q(pack.article.slug)};
    SELECT * FROM media WHERE id IN (${pack.media.map(m => q(m.record.id)).join(',')}) OR object_key IN (${pack.media.map(m => q(m.record.object_key)).join(',')});
    SELECT * FROM forum_threads WHERE article_id=${articleId};
    SELECT * FROM facebook_posts WHERE article_id=${articleId};
    SELECT id,name FROM user WHERE id IN (${q(pack.actor.id)},'newsroom');
    SELECT name FROM d1_migrations ORDER BY id;
    SELECT (SELECT COUNT(*) FROM news_articles) stories,(SELECT COUNT(*) FROM media) media,(SELECT COUNT(*) FROM forum_threads) discussions;
    SELECT * FROM admin_audit_log WHERE target_id=${articleId};`);
  return Object.fromEntries(['articles','media','threads','facebook','users','migrations','counts','audits'].map((key,i) => [key,results[i]]));
}
let current = inspect();
assert(current.users.some(u => u.id === pack.actor.id && u.name === 'JD'));
assert(current.users.some(u => u.id === 'newsroom'));
if (!current.articles.length) {
  assert.equal(current.media.length, 0); assert.equal(current.threads.length, 0); assert.equal(current.facebook.length, 0);
  assert(!existsSync(dir + 'production-sync-intent.json'), 'Inspect incomplete previous write first');
  save('production-before.json', current);
  for (const photo of pack.media) {
    assert.equal(hash(readFileSync(photo.file)), photo.sha256);
    const output = cli(['r2', 'object', 'put', 'firelands-current-media/' + photo.record.object_key, '--remote', '--file', photo.file, '--content-type', photo.record.content_type]);
    writeFileSync(dir + photo.record.id + '-upload.txt', output);
  }
  const now = Date.now();
  const audit = (action, row, type='story') => ({ id: randomUUID(), actor_id: pack.actor.id, actor_name: pack.actor.name, target_type: type, target_id: row.id, target_label: row.headline ?? row.filename, action, detail: 'Publisher authorized Fieldstone production sync; original PDF and supplied press photos.', outcome: 'success', created_at: now });
  const sql = [
    ...pack.media.map(m => insert('media', m.record)),
    ...pack.media.map(m => insert('admin_audit_log', { id: randomUUID(), actor_id: pack.actor.id, actor_name: pack.actor.name, target_media_id: m.record.id, target_label: m.record.filename, action: 'media-upload', detail: 'Supplied press photo for approved Fieldstone story.', created_at: now })),
    insert('news_articles', { ...pack.article, status: 'draft' }),
    insert('facebook_posts', { article_id: pack.article.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now }),
    insert('forum_threads', pack.thread),
    insert('admin_audit_log', audit('story-create', pack.article)), insert('admin_audit_log', audit('story-publish', pack.article)),
    `UPDATE news_articles SET status='published' WHERE id=${articleId};`,
  ].join('\n');
  write('production-sync', sql);
  current = inspect();
}
assert.equal(current.articles.length, 1);
assert.deepEqual(current.articles[0], pack.article);
assert.equal(current.media.length, 2);
for (const photo of pack.media) assert.deepEqual(current.media.find(m => m.id === photo.record.id), photo.record);
assert.equal(current.threads.length, 1);
for (const [key,value] of Object.entries(pack.thread)) assert.equal(current.threads[0][key], value);
const html = new TextDecoder().decode(await fetchBytes('/news/' + pack.article.slug));
assert(html.includes(pack.article.headline)); assert(html.includes('/profile/' + pack.actor.id));
assert(html.includes('/talk/' + pack.thread.id)); assert(html.includes(pdf.public_url));
for (const photo of pack.media) {
  assert(html.includes('/media/' + photo.record.object_key) && html.includes(photo.record.alt) && html.includes(photo.record.caption) && html.includes(photo.record.credit));
  assert.equal(hash(await fetchBytes('/media/' + photo.record.object_key)), photo.sha256);
}
await fetchBytes('/talk/' + pack.thread.id);
const before = read('production-before.json');
for (const [field, delta] of [['stories',1],['media',2],['discussions',1]]) assert.equal(current.counts[0][field], before.counts[0][field] + delta);
save('production-live-verification.json', { at: new Date().toISOString(), story: origin + '/news/' + pack.article.slug, pdf: true, photos: 2, checksums: true, byline: true, discussion: true, counts: current.counts[0] });
assert.equal(current.facebook.length, 1);
if (current.facebook[0].status === 'review') {
  const now = Date.now();
  assert.equal(current.facebook[0].attempts, 0); assert.equal(current.facebook[0].post_id, null);
  write('production-queue', `UPDATE facebook_posts SET status='pending',next_attempt_at=${now},last_error=NULL,claim_id=NULL,updated_at=${now} WHERE article_id=${articleId} AND status='review' AND attempts=0 AND post_id IS NULL;\n` + insert('admin_audit_log', { id: randomUUID(), actor_id: pack.actor.id, actor_name: pack.actor.name, target_type: 'story', target_id: pack.article.id, target_label: pack.article.headline, action: 'facebook_queue', detail: 'Publisher authorized first-time Facebook delivery after live story, photos and PDF verification.', outcome: 'success', created_at: now }));
}
current = inspect();
assert(['pending','posting','posted'].includes(current.facebook[0].status));
save('production-facebook.json', { at: new Date().toISOString(), facebook: current.facebook });
console.log(JSON.stringify({ url: origin + '/news/' + pack.article.slug, pdf: origin + pdf.public_url, facebook: current.facebook.map(({ status,attempts,post_id,last_error }) => ({ status,attempts,post_id,last_error })) }));
