// Rebuild a past day's packet manifest from the files its dated scripts used, so the shared tool can be
// proven against what actually ran (docs/editorial-tools.md, "Rebuilding a past packet").
//
//   node scripts/editorial/manifest-from-research.mjs --date 2026-10-24 [--author-email jd@orboro.net]
//
// It reads `research.json` and the dated run's `local-import.json` (which says which stories, events and
// updates were really imported and the reviewed photo checksums) from the day's project-library folder,
// plus `evidence/existing-content.json` for update baselines, and writes `packet.json` beside them.
// It understands the research.json layout of Oct. 21-26 (story `image` blocks with a library photo, ready
// events, `updates` with `proposed_copy`). New days write their manifest directly.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { editorialDirectory } from '../project-library.mjs';
import { baselineHash } from './lib/manifest.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const date = option('--date');
assert(/^\d{4}-\d{2}-\d{2}$/.test(date ?? ''), '--date YYYY-MM-DD is required');
const dir = editorialDirectory(date);
const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const research = read('research.json'), ran = read('local-import.json');
assert.equal(research.date, date);
assert(!existsSync(join(dir, 'packet.json')), 'packet.json already exists; keep it or remove it deliberately');

const importedSlugs = new Set([...ran.articles, ...ran.events].map(row => row.slug));
const stories = research.stories.filter(story => importedSlugs.has(story.slug));
const events = research.events.filter(event => importedSlugs.has(event.slug));
assert.equal(stories.length, ran.articles.length); assert.equal(events.length, ran.events.length);

const media = [];
for (const story of stories) {
  if (story.image.status !== 'library') { assert(['none', 'shoot', 'permission-needed'].includes(story.image.status), 'Write the upload entry for this photo by hand: ' + story.key); continue; }
  const reviewed = ran.images.find(image => image.record.id === story.image.media_id);
  assert(reviewed, 'The dated run did not record this photo: ' + story.key);
  media.push({ key: 'photo-' + story.key, action: 'reuse', id: story.image.media_id, sha256: reviewed.stored_sha256, caption: story.image.caption, credit: story.image.credit,
    source_url: story.image.source_url, license_url: story.image.license_url });
}

const updates = [];
for (const update of research.updates ?? []) {
  const applied = (ran.updates ?? []).find(change => change.after.slug === update.slug);
  if (!applied) continue;
  const existing = read('evidence/existing-content.json').articles.find(row => row.slug === update.slug);
  assert(existing, 'No reviewed baseline for ' + update.slug);
  const fields = { headline: update.headline, summary: update.summary, body: update.proposed_copy };
  updates.push({ table: 'news_articles', slug: update.slug, fields, baseline_sha256: baselineHash(existing, Object.keys(fields)), note: 'Baseline from evidence/existing-content.json' });
}

const manifest = {
  schema: 1, date,
  summary: research.scope ?? `Packet for ${date}, rebuilt from the dated scripts' research.json`,
  inputs: ['research.json'],
  author: { email: option('--author-email') ?? 'jd@orboro.net', name: ran.actor.name },
  stories: stories.map(({ key, slug, section, community, headline, summary, body, image }) => ({ key, slug, section, community, headline, summary, body, ...(image.status === 'library' ? { media: 'photo-' + key } : {}) })),
  events: events.map(({ key, slug, title, summary, description, category, starts_on, start_time, ends_on, end_time, hours_note, venue, address, community, organizer, organizer_url, cost, source_url }) =>
    ({ key, slug, title, summary, description, category, starts_on, start_time, ends_on, end_time, hours_note, venue, address, community, organizer, organizer_url, cost, source_url })),
  updates, features: [], media,
  facebook: { queue: 'new-stories' },
  expect: { stories: stories.length, events: events.length, updates: updates.length, features: 0, reused_media: media.length, uploads: 0 },
};
writeFileSync(join(dir, 'packet.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${join(dir, 'packet.json')}: ${stories.length} stories, ${events.length} events, ${updates.length} updates, ${media.length} reused photos`);
