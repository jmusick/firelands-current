// Page and file checks against a running site: the local dev server, a rehearsal server, or production.
import assert from 'node:assert/strict';
import { easternToIcsUtc, escapeHtml, hash } from './util.mjs';

const has = (html, text) => html.includes(escapeHtml(text)) || html.includes(text);
const get = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(20000), ...options });

/** Fetch each library photo the packet uses and compare it with the checksum recorded when it was reviewed. */
export async function checkImages(origin, images) {
  const checked = [];
  for (const photo of images) {
    const url = origin + '/media/' + photo.record.object_key;
    const response = await get(url);
    assert.equal(response.status, 200, 'Image unavailable: ' + url);
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), photo.stored_sha256, 'Image differs from the reviewed file: ' + url);
    checked.push({ url, status: 200, checksum_verified: true });
  }
  return checked;
}

/**
 * Check every story and event page the packet publishes or updates.
 * ctx: { manifest, articles, events, updatedArticles, updatedEvents, threads, images }, where threads covers
 * both new discussions and the existing ones that updated pages must keep linking to.
 */
export async function checkPages(origin, ctx, { lists = false } = {}) {
  const checked = [];
  const mediaEntry = id => ctx.images.find(photo => photo.record.id === id);
  const newIds = new Set(ctx.articles.map(row => row.id));
  for (const [kind, rows] of [['news', [...ctx.articles, ...ctx.updatedArticles]], ['events', [...ctx.events, ...ctx.updatedEvents]]]) {
    for (const row of rows) {
      const url = `${origin}/${kind}/${row.slug}`;
      const response = await get(url, { headers: { 'Cache-Control': 'no-cache' } });
      assert.equal(response.status, 200, url);
      const html = await response.text();
      assert(has(html, row.headline ?? row.title) && has(html, row.summary), 'Title or summary missing: ' + url);
      const thread = ctx.threads.find(item => item.article_id === row.id || item.event_id === row.id);
      assert(thread && html.includes('/talk/' + thread.id), 'Discussion link missing: ' + url);
      if (kind === 'news') {
        assert(html.includes('/profile/' + row.author_id), 'Byline profile link missing: ' + url);
        assert(html.includes('property="og:image"'), 'Social preview missing: ' + url);
        if (row.lead_media_id) {
          const photo = mediaEntry(row.lead_media_id);
          assert(photo && html.includes('/media/' + photo.record.object_key), 'Lead photo missing: ' + url);
          assert(has(html, photo.record.alt) && has(html, photo.record.caption) && has(html, photo.record.credit), 'Photo alt, caption or credit missing: ' + url);
          const entry = ctx.manifest.media.find(item => item.key === photo.key);
          for (const link of [entry?.source_url, entry?.license_url].filter(Boolean)) assert(has(html, link), 'Photo source or license link missing: ' + url);
        } else if (newIds.has(row.id)) assert(html.includes('/social-logo.png?v=2'), 'Masthead social fallback missing: ' + url);
      } else {
        assert(has(html, row.link), 'Organizer source link missing: ' + url);
        const calendar = await get(url + '.ics');
        assert.equal(calendar.status, 200, 'Calendar export: ' + url);
        const lines = (await calendar.text()).split(/\r?\n/);
        assert(lines.includes('BEGIN:VEVENT'), 'Calendar data: ' + url);
        // A late Eastern start can fall on the next UTC date in a timed export.
        const expectedStart = row.start_time
          ? 'DTSTART:' + easternToIcsUtc(row.starts_on, row.start_time)
          : 'DTSTART;VALUE=DATE:' + row.starts_on.replaceAll('-', '');
        assert(lines.includes(expectedStart), 'Calendar start time: ' + url);
      }
      checked.push({ url, status: 200 });
    }
  }
  checked.push(...await checkImages(origin, ctx.images));
  if (lists) {
    for (const path of ['/news', '/events']) {
      const response = await get(origin + path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      if (path === '/news') for (const row of ctx.articles) assert(html.includes(row.slug), 'Story missing from /news: ' + row.slug);
      checked.push({ url: origin + path, status: 200 });
    }
  }
  return checked;
}

/** Local checks only ever talk to a machine's own dev server. */
export function assertLocalOrigin(origin) {
  const url = new URL(origin);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local and rehearsal checks must use a localhost origin: ' + origin);
  return url.origin;
}
