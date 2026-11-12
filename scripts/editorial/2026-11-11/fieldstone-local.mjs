import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

// Local review only. Keep the supplied release and original photos with the publication record.
const dir = editorialDirectory('2026-11-11') + 'fieldstone/';
mkdirSync(dir, { recursive: true });
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = 'fieldstone-fostoria-new-name-renovations';
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
globalThis.__fieldstoneLocalEnv = proxy.env;
const envModule = 'data:text/javascript,export const env=globalThis.__fieldstoneLocalEnv;';
function moduleUrl(path, replacements) {
  let source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => `from ${JSON.stringify(replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const forumModule = moduleUrl('src/lib/forum.ts', { 'cloudflare:workers': envModule });
const media = await import(moduleUrl('src/lib/media.ts', { 'cloudflare:workers': envModule, './forum': forumModule }));
const db = proxy.env.DB;
const tables = ['news_articles', 'media', 'forum_threads', 'facebook_posts', 'admin_audit_log', 'events'];
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results])));
const insert = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
try {
  assert.equal(proxy.env.FACEBOOK_AUTO_POST_ENABLED, 'false');
  assert(!existsSync(dir + 'import.json') && !existsSync(dir + 'pending.json'), 'Inspect the existing import journal before retrying.');
  const before = await snapshot();
  assert(!before.news_articles.some(row => row.slug === slug || /fieldstone/i.test(row.headline)), 'Story already exists.');
  const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
  assert.equal(actor?.name, 'JD');
  assert(await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first());
  save('before.json', before);
  const filenames = ['Fieldstone_Post_Event_Release.pdf', 'Fieldstone PR Image 1.JPG', 'Fieldstone PR Image 2.JPG'];
  for (const filename of filenames) copyFileSync('C:/Users/JD/Downloads/' + filename, dir + filename);
  save('source.json', { received: '2026-11-11T11:03:00-05:00', release_date: '2026-11-10', sender: 'Tehila Safer, Elvira Care Group', email_url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQjgqPztTxQfbttqcnsfCCnCtTg', authorization: 'Publisher requested local story using release information.', permission: 'Original photos supplied expressly for local coverage; credit Toni With An Eye Photography.', pdf_review: 'Both pages visually reviewed; release and captions match email. PDF is retained as source material, not uploaded as a public image.', files: filenames.map(filename => ({ filename, sha256: hash(readFileSync(dir + filename)) })) });
  const photos = [
    { filename: filenames[1], alt: 'Staff and community guests hold a green ribbon beneath a balloon arch as a woman at the center cuts it.', caption: 'Administrator Stephanie Seay cuts the ribbon with staff and community guests at Fieldstone Nursing and Rehabilitation Center in Fostoria on Oct. 26, 2026.' },
    { filename: filenames[2], alt: 'The therapy gym contains parallel bars, exercise equipment, a practice staircase and a bed.', caption: 'Fieldstone’s updated therapy gym was one of the stops on the Oct. 26, 2026, guest tour.' },
  ];
  const uploads = [], statements = [];
  try {
    for (const photo of photos) {
      const bytes = readFileSync(dir + photo.filename);
      const checked = await media.checkUpload(new File([bytes], photo.filename, { type: 'image/jpeg' }));
      assert.notEqual(typeof checked, 'string', String(checked));
      const details = { alt: photo.alt, decorative: false, caption: photo.caption, credit: 'Toni With An Eye Photography', source: 'Supplied by Tehila Safer, Elvira Care Group, Nov. 11, 2026, with Fieldstone press release expressly for local coverage. Original release and photos retained in project library editorial/2026-11-11/fieldstone.' };
      assert.deepEqual(media.validateDetails(details), []);
      const upload = await media.storeMedia(checked, photo.filename, details, actor.id);
      uploads.push({ ...upload.record, sha256: hash(checked.bytes) });
      statements.push(upload.statement, media.mediaAudit(actor, upload.record, 'media-upload', 'Publisher authorized Fieldstone local story; supplied press photo.'));
    }
    const now = Date.now();
    const article = { id: randomUUID(), slug, headline: 'Fieldstone marks new name, renovations at Fostoria nursing center', summary: 'The former Saint Catherine’s Manor celebrated its name change with an Oct. 26 ribbon cutting after updates to resident units and its therapy gym.', section: 'business', community: 'Fostoria', byline: actor.name, author_id: actor.id, lead_media_id: uploads[0].id, featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now,
      body: `Fieldstone Nursing and Rehabilitation Center in Fostoria has remodeled resident units and updated its therapy gym since coming under new ownership May 1, according to a news release from the center.

The 56-bed facility, formerly Saint Catherine’s Manor of Fostoria, celebrated its name change with an Oct. 26 ribbon cutting at 25 Christopher Drive. Nearly 50 guests attended, including residents, families and representatives of local health care organizations and the Fostoria Area Chamber of Commerce, the release said.

Administrator Stephanie Seay cut the ribbon, and guests toured the remodeled units and therapy gym. The center also upgraded therapy equipment, according to the release.

“Our goal is to build meaningful relationships with residents, families, healthcare partners, and community organizations,” Seay said in the release.

![${photos[1].alt}](/media/${uploads[1].object_key})

Fieldstone provides short-term rehabilitation and long-term care, with respiratory therapy, rehabilitation medicine and wound care programs, according to the release.

Information is available on [Fieldstone’s website](https://www.fieldstonerehab.com/) or by calling 419-435-8112.` };
    const thread = { id: randomUUID(), author_id: 'newsroom', title: article.headline, body: article.summary, article_id: article.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now };
    const audits = ['story-create', 'story-publish'].map(action => ({ id: randomUUID(), actor_id: actor.id, actor_name: actor.name, target_type: 'story', target_id: article.id, target_label: article.headline, action, detail: 'Publisher requested Fieldstone release rewrite in local dev only.', outcome: 'success', created_at: now }));
    statements.push(insert('news_articles', article), insert('forum_threads', thread), ...audits.map(row => insert('admin_audit_log', row)));
    statements.push(db.prepare('UPDATE facebook_posts SET status=?,updated_at=? WHERE article_id=? AND status=? AND attempts=0').bind('review', now, article.id, 'pending'));
    const journal = { target: 'local', article, thread, media: uploads, audits };
    save('pending.json', journal);
    await media.batchWithUploads(uploads, statements);
    const after = await snapshot();
    const deltas = { news_articles: 1, media: 2, forum_threads: 1, facebook_posts: 1, admin_audit_log: 4, events: 0 };
    for (const table of tables) {
      assert.equal(after[table].length, before[table].length + deltas[table], table);
      for (const old of before[table]) assert.deepEqual(after[table].find(row => (row.id ?? row.article_id) === (old.id ?? old.article_id)), old, 'Existing row changed: ' + table);
    }
    assert.deepEqual(after.news_articles.find(row => row.id === article.id), article);
    assert(after.facebook_posts.some(row => row.article_id === article.id && row.status === 'review' && row.attempts === 0));
    for (const photo of uploads) {
      const object = await proxy.env.MEDIA.get(photo.object_key);
      assert.equal(hash(new Uint8Array(await object.arrayBuffer())), photo.sha256);
    }
    save('import.json', { ...journal, verified_at: new Date().toISOString(), unrelated_rows_unchanged: true });
    console.log(JSON.stringify({ url: 'http://127.0.0.1:4321/news/' + slug, id: article.id, library: dir, media: uploads.length, unrelated_rows_unchanged: true }));
  } catch (error) {
    await media.discardUnsavedMedia(uploads);
    throw error;
  }
} finally { await proxy.dispose(); }
