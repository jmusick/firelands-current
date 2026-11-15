import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const mode = process.argv[2];
assert(['--inspect', '--import', '--verify'].includes(mode) && process.argv.length === 3);
const dir = editorialDirectory('2026-11-14');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const save = (name, data) => writeFileSync(dir + name, JSON.stringify(data, null, 2) + '\n');
const packet = read('research.json');
const packetHash = createHash('sha256').update(readFileSync(dir + 'research.json')).digest('hex');
const tables = ['news_articles', 'forum_threads', 'facebook_posts', 'admin_audit_log', 'events', 'media'];
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
try {
  assert.equal(proxy.env.FACEBOOK_AUTO_POST_ENABLED, 'false');
  const db = proxy.env.DB;
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await db.prepare(`SELECT * FROM ${t}`).all()).results])));
  const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
  assert.equal(actor?.name, 'JD');
  assert(await db.prepare('SELECT id FROM user WHERE id=?').bind('newsroom').first());
  const insert = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
  function verify(before, after, data) {
    const deltas = { news_articles: 3, forum_threads: 3, facebook_posts: 3, admin_audit_log: 6, events: 0, media: 0 };
    for (const table of tables) {
      assert.equal(after[table].length, before[table].length + deltas[table], table);
      for (const row of before[table]) assert.deepEqual(after[table].find(r => (r.id ?? r.article_id) === (row.id ?? row.article_id)), row, 'Existing row changed: ' + table);
    }
    for (const [table, rows] of [['news_articles', data.articles], ['forum_threads', data.threads], ['admin_audit_log', data.audits]]) {
      for (const row of rows) for (const [field, value] of Object.entries(row)) assert.equal(after[table].find(r => r.id === row.id)?.[field], value, `${table}.${field}`);
    }
    for (const a of data.articles) {
      const social = after.facebook_posts.find(r => r.article_id === a.id);
      assert(social?.status === 'review' && social.attempts === 0 && social.post_id === null);
    }
  }
  if (mode === '--inspect') {
    console.log(JSON.stringify({ actor, counts: Object.fromEntries(Object.entries(await snapshot()).map(([t, r]) => [t, r.length])), duplicates: (await db.prepare('SELECT slug FROM news_articles WHERE slug IN (?,?,?)').bind(...packet.stories.map(s => s.slug)).all()).results }));
  } else if (mode === '--import') {
    assert.equal(packet.date, '2026-11-14');
    assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()), packet.date);
    assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect prior import journal before retrying');
    const before = await snapshot();
    const now = Date.now();
    const data = { actor, research_sha256: packetHash, imported_at: new Date(now).toISOString(), articles: [], threads: [], audits: [] };
    assert.equal(packet.stories.length, 3);
    for (const s of packet.stories) {
      assert.equal(s.status, 'ready');
      assert(!s.body.includes('[NEED:') && ['none', 'library'].includes(s.image.status));
      assert(!before.news_articles.some(a => a.slug === s.slug), 'Duplicate slug: ' + s.slug);
      if (s.image.status === 'library') {
        const media = await db.prepare('SELECT object_key FROM media WHERE id=?').bind(s.image.media_id).first();
        assert(media, 'Missing library photo: ' + s.image.media_id);
        assert(await proxy.env.MEDIA.head(media.object_key), 'Missing local R2 photo: ' + media.object_key);
      }
      const article = { id: randomUUID(), slug: s.slug, headline: s.headline, summary: s.summary, body: s.body, section: s.section, community: s.community, byline: actor.name, author_id: actor.id, lead_media_id: s.image.status === 'library' ? s.image.media_id : null, featured: 0, status: 'published', published_at: now, created_at: now, updated_at: now };
      data.articles.push(article);
      data.threads.push({ id: randomUUID(), author_id: 'newsroom', title: s.headline, body: s.summary, article_id: article.id, status: 'published', created_at: now, updated_at: now, last_activity_at: now });
      for (const action of ['create', 'publish']) data.audits.push({ id: randomUUID(), actor_id: actor.id, actor_name: actor.name, target_type: 'story', target_id: article.id, target_label: s.headline.slice(0, 200), action: 'story-' + action, detail: 'Editor authorized Nov. 14 newsroom articles in local dev for review only; no production sync or Facebook delivery', outcome: 'success', created_at: now });
    }
    save('local-before.json', before);
    save('local-import-pending.json', data);
    // Precreate review-only social rows so the publication trigger cannot queue delivery.
    const statements = [
      ...data.articles.map(a => insert('news_articles', { ...a, status: 'draft' })),
      ...data.articles.map(a => insert('facebook_posts', { article_id: a.id, status: 'review', attempts: 0, next_attempt_at: now, created_at: now, updated_at: now })),
      ...data.threads.map(t => insert('forum_threads', t)),
      ...data.audits.map(a => insert('admin_audit_log', a)),
      ...data.articles.map(a => db.prepare("UPDATE news_articles SET status='published' WHERE id=? AND status='draft'").bind(a.id)),
    ];
    const results = await db.batch(statements);
    save('evidence/local-write-result.json', results);
    assert(results.every(r => r.success && r.meta.changes >= 1));
    save('local-import.json', data);
    verify(before, await snapshot(), data);
    console.log(JSON.stringify({ imported: data.articles.map(a => ({ headline: a.headline, url: 'http://127.0.0.1:4321/news/' + a.slug })), byline: actor.name, discussions: 3, facebook: 'review; no delivery queued', events_imported: 0 }));
  } else {
    const data = read('local-import.json');
    assert.equal(data.research_sha256, packetHash);
    const after = await snapshot();
    verify(read('local-before.json'), after, data);
    const checked = [];
    for (const a of data.articles) {
      const url = 'http://127.0.0.1:4321/news/' + a.slug;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      const html = await response.text();
      const esc = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      assert(html.includes(esc(a.headline)) && html.includes(esc(a.summary)));
      assert(html.includes('/profile/' + actor.id));
      if (a.lead_media_id) {
        const media = await db.prepare('SELECT object_key FROM media WHERE id=?').bind(a.lead_media_id).first();
        const imageUrl = 'http://127.0.0.1:4321/media/' + media.object_key;
        assert(html.includes('/media/' + media.object_key));
        const imageResponse = await fetch(imageUrl);
        assert.equal(imageResponse.status, 200, imageUrl);
        assert((imageResponse.headers.get('content-type') || '').startsWith('image/'));
      }
      assert(html.includes('/talk/' + data.threads.find(t => t.article_id === a.id).id));
      for (const u of packet.stories.find(s => s.slug === a.slug).source_urls.filter(u => a.body.includes(u))) assert(html.includes(esc(u)));
      checked.push({ url, status: response.status, linked_JD_byline: true, discussion: true, source_links: true, lead_photo: a.lead_media_id !== null });
    }
    const response = await fetch('http://127.0.0.1:4321/news');
    assert.equal(response.status, 200);
    const index = await response.text();
    for (const a of data.articles) assert(index.includes(a.slug));
    save('evidence/local-http-verification.json', { checked_at: new Date().toISOString(), checked, index: 200, unrelated_rows_unchanged: true, facebook_disabled: true });
    console.log(JSON.stringify({ verified: checked.length, index: 200, existing_rows_unchanged: true, facebook: 'review only' }));
  }
} finally {
  await proxy.dispose();
}
