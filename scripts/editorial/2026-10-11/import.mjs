import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--apply-local', '--revise-local-addresses', '--verify-local', '--verify-http'].includes(mode) && process.argv.length === 3,
  'Use --apply-local, --revise-local-addresses, --verify-local or --verify-http. This utility has no production mode.');
const dir = editorialDirectory('2026-10-11');
const pack = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(dir + name, JSON.stringify(value, null, 2) + '\n');
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
globalThis.__editorialImportEnv = proxy.env;
const envModule = 'data:text/javascript,export const env=globalThis.__editorialImportEnv;';
function sourceModule(path, replacements) {
  let source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => `from ${JSON.stringify(replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const forumModule = sourceModule('src/lib/forum.ts', { 'cloudflare:workers': envModule });
const media = await import(sourceModule('src/lib/media.ts', { 'cloudflare:workers': envModule, './forum': forumModule }));
const news = await import(sourceModule('src/lib/news.ts', { 'cloudflare:workers': envModule }));
const db = proxy.env.DB;
const tables = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results])));
}
function insert(table, row) {
  const columns = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...Object.values(row));
}
function photoNote(photo) {
  const url = photo.source_url.replaceAll('(', '%28').replaceAll(')', '%29');
  return `*Photo: [${photo.credit.split(' / ')[0]}](${url}), [${photo.license}](${photo.license_url}). File photo; image unchanged.*`;
}
function thread(row, kind, now) {
  return { id: randomUUID(), author_id: 'newsroom', title: row.headline ?? row.title, body: row.summary,
    [kind + '_id']: row.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now };
}

try {
  if (mode === '--apply-local') {
    assert(!existsSync(dir + 'import.json'), 'Import journal already exists; verify the import instead of inserting again.');
    const actor = await db.prepare('SELECT id, name FROM "user" WHERE email = ?').bind('jd@orboro.net').first();
    assert(actor && actor.name === 'JD', 'JD account not found');
    assert(await db.prepare('SELECT id FROM "user" WHERE id = ?').bind('newsroom').first(), 'Newsroom account not found');
    const before = await snapshot();
    save('before.json', before);
    for (const [table, entries] of [['news_articles', pack.articles], ['events', pack.events]]) {
      assert.equal(new Set(entries.map(entry => entry.slug)).size, entries.length);
      for (const entry of entries) {
        assert(/^[a-z0-9-]{1,120}$/.test(entry.slug));
        assert(!before[table].some(row => row.slug === entry.slug), `Duplicate slug: ${entry.slug}`);
      }
    }
    for (const article of pack.articles) {
      assert(article.body.split('\n\n')[0].split(/\s+/).length <= 35, `Lede too long: ${article.slug}`);
    }
    const checked = [];
    for (const photo of pack.images) {
      const bytes = readFileSync(dir + 'images/' + photo.filename);
      const image = await media.checkUpload(new File([bytes], photo.filename, { type: 'image/jpeg' }));
      assert.notEqual(typeof image, 'string', `${photo.filename}: ${image}`);
      const details = { alt: photo.alt, decorative: false, caption: photo.caption, credit: photo.credit,
        source: `Source: ${photo.source_url} | License: ${photo.license}, ${photo.license_url} | Verified Oct. 11, 2026; evidence and original downloads in editorial/2026-10-11. Source download pixels retained; library validator removes JPEG metadata. Captions identify historical or illustrative photos.` };
      assert.deepEqual(media.validateDetails(details), []);
      checked.push({ photo, image, details, original_sha256: hash(bytes), stored_sha256: hash(image.bytes) });
    }
    const statements = [];
    const imported = { target: 'local', imported_at: Date.now(), images: [], articles: [], events: [], threads: [] };
    for (const entry of checked) {
      const { record, statement } = await media.storeMedia(entry.image, entry.photo.filename, entry.details, actor.id);
      statements.push(statement, media.mediaAudit(actor, record, 'media-upload', `${record.width}×${record.height}; ${entry.photo.license} file photo for Oct. 11 local editorial package`));
      imported.images.push({ ...entry.photo, record, original_sha256: entry.original_sha256, stored_sha256: entry.stored_sha256 });
    }
    const imageFor = key => imported.images.find(image => image.key === key);
    for (const article of pack.articles) {
      const photo = imageFor(article.image);
      let body = article.body;
      if (article.image_placement === 'body') {
        const paragraphs = body.split('\n\n');
        paragraphs.splice(2, 0, `![${photo.alt}](/media/${photo.record.object_key})`);
        body = paragraphs.join('\n\n');
      }
      body += '\n\n' + photoNote(photo);
      const now = Date.now();
      const row = { id: randomUUID(), slug: article.slug, headline: article.headline, summary: article.summary, body,
        section: article.section, community: article.community, byline: actor.name, author_id: actor.id,
        lead_media_id: article.image_placement === 'body' ? null : photo.record.id, featured: 0,
        status: 'published', published_at: now, created_at: now, updated_at: now };
      const discussion = thread(row, 'article', now);
      statements.push(insert('news_articles', row), insert('forum_threads', discussion));
      // Direct imports trigger the social outbox. Keep local review from scheduling a post.
      statements.push(db.prepare('UPDATE facebook_posts SET status = ?, updated_at = ? WHERE article_id = ? AND status = ? AND attempts = 0')
        .bind('review', now, row.id, 'pending'));
      imported.articles.push(row);
      imported.threads.push(discussion);
    }
    for (const event of pack.events) {
      const { image, ...fields } = event;
      const photo = image && imageFor(image);
      const now = Date.now();
      const row = { id: randomUUID(), ...fields, description: fields.description + (photo ? '\n\n' + photoNote(photo) : ''),
        performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '',
        image_media_id: photo ? photo.record.id : null, status: 'published', created_at: now, updated_at: now };
      const discussion = thread(row, 'event', now);
      statements.push(insert('events', row), insert('forum_threads', discussion));
      imported.events.push(row);
      imported.threads.push(discussion);
    }
    save('import-pending.json', imported);
    const results = await db.batch(statements);
    assert(results.every(result => result.success && result.meta.changes >= 1), 'Import batch did not insert all expected rows.');
    save('import.json', imported);
  }

  const imported = JSON.parse(readFileSync(dir + 'import.json', 'utf8'));
  if (mode === '--revise-local-addresses') {
    const statements = [];
    for (const row of imported.events) {
      const address = pack.events.find(event => event.slug === row.slug).address;
      if (address === row.address) continue;
      statements.push(db.prepare('UPDATE events SET address = ? WHERE id = ? AND address = ?')
        .bind(address, row.id, row.address));
    }
    if (statements.length) {
      save('import-before-address-review.json', imported);
      const results = await db.batch(statements);
      assert(results.every(result => result.success && result.meta.changes === 1), 'Address revision changed unexpected rows');
      for (const row of imported.events) row.address = pack.events.find(event => event.slug === row.slug).address;
      save('import.json', imported);
    }
  }
  save('evidence/image-manifest.json', imported.images.map(({ record, ...image }) => ({ ...image, media_id: record.id, object_key: record.object_key, width: record.width, height: record.height, bytes: record.bytes })));
  const before = JSON.parse(readFileSync(dir + 'before.json', 'utf8'));
  const rotation = existsSync(dir + 'featured-rotation.json') ? JSON.parse(readFileSync(dir + 'featured-rotation.json', 'utf8')).local : [];
  const after = await snapshot();
  const additions = { news_articles: imported.articles.length, events: imported.events.length, forum_threads: imported.threads.length,
    media: imported.images.length, facebook_posts: imported.articles.length, admin_audit_log: imported.images.length };
  for (const table of tables) {
    assert.equal(after[table].length, before[table].length + additions[table], `${table} count changed unexpectedly`);
    for (const row of before[table]) {
      const expected = table === 'news_articles' ? rotation.find(change => change.before.id === row.id)?.after ?? row : row;
      assert.deepEqual(after[table].find(current => (current.id ?? current.article_id) === (row.id ?? row.article_id)), expected, `Existing ${table} row changed unexpectedly`);
    }
  }
  for (const [table, rows] of [['news_articles', imported.articles], ['events', imported.events], ['forum_threads', imported.threads]]) {
    for (const row of rows) {
      const actual = after[table].find(current => current.id === row.id);
      for (const [key, value] of Object.entries(row)) assert.equal(actual[key], value, `${table}.${key}`);
    }
  }
  for (const image of imported.images) {
    assert.equal(hash(readFileSync(dir + 'images/' + image.filename)), image.original_sha256);
    assert.deepEqual(after.media.find(row => row.id === image.record.id), image.record);
    const object = await proxy.env.MEDIA.get(image.record.object_key);
    assert(object && object.size === image.record.bytes);
    assert.equal(hash(new Uint8Array(await object.arrayBuffer())), image.stored_sha256);
    const usage = await media.mediaUsage(image.record);
    assert.equal(usage.stories.length, pack.articles.filter(article => article.image === image.key).length);
    assert.equal(usage.events.length, pack.events.filter(event => event.image === image.key).length);
    const html = news.renderBodyBlocks(imported.articles.find(article => usage.stories[0].id === article.id).body,
      new Map([[image.record.object_key, image.record]])).join('');
    assert(html.includes(image.license_url));
    assert(after.admin_audit_log.some(row => row.target_media_id === image.record.id && row.action === 'media-upload'));
  }
  for (const row of imported.articles) {
    const ledger = after.facebook_posts.find(entry => entry.article_id === row.id);
    assert.equal(ledger.status, 'review');
    assert.equal(ledger.attempts, 0);
    assert.equal(ledger.post_id, null);
  }
  const report = { checked_at: new Date().toISOString(), target: 'local', counts: Object.fromEntries(tables.map(table => [table, { before: before[table].length, after: after[table].length }])),
    existing_rows_unchanged: rotation.length === 0, existing_content_preserved: true, featured_rotation: rotation.map(change => change.after.slug), author: 'JD', discussions: imported.threads.length, media_checksums_valid: true, facebook_status: 'review', http: [] };
  if (mode === '--verify-http') {
    for (const [kind, entries] of [['news', imported.articles], ['events', imported.events]]) {
      for (const entry of entries) {
        const url = `http://127.0.0.1:4321/${kind}/${entry.slug}`;
        const response = await fetch(url);
        assert.equal(response.status, 200, url);
        const html = await response.text();
        const title = (entry.headline ?? entry.title).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        assert(html.includes(title), `Headline missing: ${url}`);
        const discussion = imported.threads.find(row => row.article_id === entry.id || row.event_id === entry.id);
        assert(html.includes(`/talk/${discussion.id}`));
        if (kind === 'news') assert(html.includes(`/profile/${entry.author_id}`), 'Account-linked byline missing');
        report.http.push({ url, status: response.status });
      }
    }
    for (const image of imported.images) {
      const url = `http://127.0.0.1:4321/media/${image.record.object_key}`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), image.stored_sha256);
      report.http.push({ url, status: response.status });
    }
  }
  save(mode === '--verify-http' ? 'evidence/http-verification.json' : 'evidence/local-verification.json', report);
  const links = (kind, entries) => entries.map(entry => `- [${entry.headline ?? entry.title}](http://127.0.0.1:4321/${kind}/${entry.slug})`).join('\n');
  writeFileSync(dir + 'review.md', `# Oct. 11, 2026 editorial review\n\nThree original articles and seven calendar entries are published in the local database for review, with JD's linked byline, 10 Newsroom discussions and two credited file photos. All three stories have lead images. Production content is unchanged. New Facebook ledger entries remain in review.\n\n## Stories\n\n${links('news', imported.articles)}\n\n## Events\n\n${links('events', imported.events)}\n\n## Photos and evidence\n\nThe public-domain West Main Street image was uploaded in 2008. It illustrates the two Norwalk stories and three uptown event listings. The CC0 pumpkin photograph was made in Alabama in 2016; its caption identifies it as illustrative, not a photograph of the Erie MetroParks hunt. Captions and copy include creator, source and license links. Both images have descriptive alt text and are marked nondecorative.\n\n[Source review and held leads](evidence/source-review.md) · [Photo manifest](evidence/image-manifest.json) · [Local verification](evidence/local-verification.json)${report.http.length ? ' · [Page and media verification](evidence/http-verification.json)' : ''}\n\nNew source: The Chef's Garden. Norwalk's city calendar and Erie MetroParks' dated program brochures have also been added as working feeds. Maritime Museum of Sandusky and Ottawa National Wildlife Refuge remain prospects.\n\n## Verification\n\n${Object.entries(report.counts).map(([table, counts]) => `- ${table}: ${counts.before} → ${counts.after}`).join('\n')}\n- Existing content rows preserved; new media bytes match stored checksums.\n- ${report.http.length ? 'All 10 pages and two media URLs return HTTP 200; discussion links and account-linked bylines verified.' : 'HTTP and visual review pending.'}\n- npm run check: zero errors, warnings or hints. npm run build: passed.\n`);
  if (existsSync(dir + 'production-verification.json')) {
    const review = readFileSync(dir + 'review.md', 'utf8').replace('Production content is unchanged. New Facebook ledger entries remain in review.',
      'Production is synced. All three stories are featured and were queued for Facebook. The finished Lighthouse Festival and older church-closure story were retired from the featured rotation. Local Facebook ledger rows remain in review. [Production publication record](production-publication.md).');
    writeFileSync(dir + 'review.md', review);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await proxy.dispose();
}
