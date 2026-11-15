// Loading and checking a packet manifest (`packet.json` in the day's project-library folder).
// The schema is documented in docs/editorial-tools.md; this file is what enforces it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { hash, normalizeText, slugPattern } from './util.mjs';

export const MANIFEST_NAME = 'packet.json';
const NEWS_UPDATE_FIELDS = ['headline', 'summary', 'body', 'section', 'community'];
const EVENT_UPDATE_FIELDS = ['title', 'summary', 'description', 'category', 'starts_on', 'start_time', 'ends_on', 'end_time', 'hours_note', 'venue', 'address', 'community', 'organizer', 'organizer_url', 'cost', 'link'];
const EVENT_TEXT_FIELDS = ['hours_note', 'venue', 'address', 'community', 'organizer', 'organizer_url', 'cost'];

const isText = value => typeof value === 'string' && value.length > 0;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTime = value => value == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const webUrl = value => { const url = new URL(value); assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Expected an HTTP(S) URL without credentials'); };
const unique = (values, label) => assert.equal(new Set(values).size, values.length, 'Duplicate ' + label);

/** The baseline hash of an existing row: its normalized values for exactly the fields an update changes, in the update's own field order. */
export function baselineHash(row, fieldNames) {
  return hash(JSON.stringify(Object.fromEntries(fieldNames.map(name => [name, normalizeText(row[name])]))));
}
export const updateTable = update => update.table === 'events' ? 'events' : 'news_articles';

/** A path from the manifest that must stay inside the packet folder. */
export function packetPath(packetDir, name) {
  const full = resolve(packetDir, name);
  const rel = relative(resolve(packetDir), full);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Path leaves the packet folder: ' + name);
  if (existsSync(full)) {
    const physical = relative(realpathSync(packetDir), realpathSync(full));
    assert(physical && !physical.startsWith('..') && !isAbsolute(physical), 'Symlink leaves the packet folder: ' + name);
  }
  return full;
}

export function validateManifest(m, date) {
  assert.equal(m.schema, 1, 'Unsupported manifest schema');
  assert.equal(m.date, date, 'Manifest date differs from --date');
  assert(validDate(m.date), 'Invalid packet date');
  assert(m.author && /^[^@\s]+@[^@\s]+$/.test(m.author.email) && isText(m.author.name), 'author.email and author.name are required');
  for (const key of ['stories', 'events', 'updates', 'features', 'media']) assert(Array.isArray(m[key]), key + ' must be a list (it may be empty)');
  assert(m.stories.length + m.events.length + m.updates.length + m.features.length > 0, 'The packet contains no publication work');
  assert(m.facebook?.queue_detail === undefined || isText(m.facebook.queue_detail), 'facebook.queue_detail must be text');
  assert(m.inputs === undefined || (Array.isArray(m.inputs) && m.inputs.every(isText)), 'inputs must be a list of file names');
  if (m.publish_window) assert(typeof m.publish_window.until === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(m.publish_window.until) && Number.isFinite(Date.parse(m.publish_window.until)), 'publish_window.until must be a date-time with an offset');
  for (const item of [...m.stories, ...m.events, ...m.media]) assert(isText(item.key) && slugPattern.test(item.key), 'Keys must use lowercase kebab-case');
  unique([...m.stories, ...m.events, ...m.media].map(item => item.key), 'key');
  unique(m.stories.map(s => s.slug), 'story slug'); unique(m.events.map(e => e.slug), 'event slug');
  const mediaKeys = new Set(m.media.map(item => item.key));
  for (const s of m.stories) {
    for (const field of ['key', 'slug', 'section', 'community', 'headline', 'summary', 'body']) assert(isText(s[field]), `Story ${s.key ?? '?'}: ${field} is required`);
    assert(slugPattern.test(s.slug) && s.slug.length <= 120, 'Bad story slug: ' + s.slug);
    assert(!s.body.includes('[NEED:'), 'Story still has a [NEED:] marker: ' + s.slug);
    assert(s.media === undefined || s.media === null || mediaKeys.has(s.media), `Story ${s.key}: unknown media key`);
  }
  for (const e of m.events) {
    for (const field of ['key', 'slug', 'title', 'summary', 'description', 'category', 'starts_on', 'source_url']) assert(isText(e[field]), `Event ${e.key ?? '?'}: ${field} is required`);
    assert(slugPattern.test(e.slug) && e.slug.length <= 120, 'Bad event slug: ' + e.slug);
    assert(validDate(e.starts_on), 'Event starts_on must be a real YYYY-MM-DD date: ' + e.slug);
    for (const field of ['start_time', 'end_time']) assert(validTime(e[field]), `Event ${e.slug}: ${field} must be HH:MM or null`);
    assert(e.ends_on == null || (validDate(e.ends_on) && e.ends_on >= e.starts_on), 'Invalid event end date');
    assert(!e.end_time || (e.start_time && (e.ends_on > e.starts_on || e.end_time > e.start_time)), 'Invalid event end time');
    webUrl(e.source_url);
    for (const field of EVENT_TEXT_FIELDS) assert(e[field] === undefined || typeof e[field] === 'string', `Event ${e.slug}: ${field} must be text`);
  }
  for (const u of m.updates) {
    assert(['news_articles', 'events'].includes(u.table), 'update.table must be news_articles or events');
    assert(isText(u.slug) && /^[a-f0-9]{64}$/.test(u.baseline_sha256 ?? ''), 'Each update needs slug and baseline_sha256');
    const allowed = u.table === 'events' ? EVENT_UPDATE_FIELDS : NEWS_UPDATE_FIELDS;
    const names = Object.keys(u.fields ?? {});
    assert(names.length > 0 && names.every(name => allowed.includes(name)), `Update ${u.slug}: fields must be among ${allowed.join(', ')}`);
    assert(names.every(name => u.fields[name] === null ? ['ends_on', 'end_time', 'start_time'].includes(name) : typeof u.fields[name] === 'string'));
  }
  unique(m.updates.map(u => u.table + ':' + u.slug), 'update target');
  for (const f of m.features) assert(!m.updates.some(u => u.table === 'news_articles' && u.slug === f.slug), 'A story cannot have both an update and a feature change in one packet: ' + f.slug);
  for (const f of m.features) assert(isText(f.slug) && typeof f.featured === 'boolean', 'Each feature change needs slug and featured (true or false)');
  unique(m.features.map(f => f.slug), 'feature target');
  for (const item of m.media) {
    assert(['reuse', 'upload'].includes(item.action), 'media.action must be reuse or upload: ' + item.key);
    for (const field of ['caption', 'credit']) assert(isText(item[field]), `Media ${item.key}: ${field} is required`);
    if (item.action === 'reuse') assert(isText(item.id) && /^[a-f0-9]{64}$/.test(item.sha256 ?? ''), `Media ${item.key}: reuse needs id and the stored object's sha256`);
    else for (const field of ['file', 'alt', 'source']) assert(isText(item[field]), `Media ${item.key}: upload needs ${field}`);
    if (item.action === 'upload') {
      for (const field of ['source_url', 'license_url']) webUrl(item[field]);
      assert(/^[a-f0-9]{64}$/.test(item.original_sha256 ?? ''), 'Uploads need the reviewed original checksum');
    }
  }
  for (const item of m.media) assert(m.stories.some(s => s.media === item.key), `Media ${item.key} is not used by any story`);
  const queue = m.facebook?.queue ?? 'new-stories';
  assert(queue === 'new-stories' || (Array.isArray(queue) && queue.every(key => m.stories.some(s => s.key === key))), 'facebook.queue must be "new-stories" or a list of story keys');
  if (m.expect) {
    const actual = { stories: m.stories.length, events: m.events.length, updates: m.updates.length, features: m.features.length, reused_media: m.media.filter(i => i.action === 'reuse').length, uploads: m.media.filter(i => i.action === 'upload').length };
    for (const [key, value] of Object.entries(m.expect)) assert.equal(actual[key], value, `expect.${key} differs from the packet's contents`);
  }
}

export function loadManifest(packetDir, date) {
  const path = resolve(packetDir, MANIFEST_NAME);
  assert(existsSync(path), `No ${MANIFEST_NAME} in ${packetDir}`);
  const bytes = readFileSync(path);
  const manifest = JSON.parse(bytes.toString('utf8'));
  validateManifest(manifest, date);
  const inputs = {};
  for (const name of manifest.inputs ?? []) inputs[name] = hash(readFileSync(packetPath(packetDir, name)));
  return { manifest, manifestSha256: hash(bytes), inputs };
}

/** What a packet's journal reports it was built from. Later modes refuse to continue when it no longer matches. */
export function assertUnchanged(journal, loaded) {
  assert.equal(journal.manifest_sha256, loaded.manifestSha256, 'Packet manifest changed after the local import; inspect before continuing');
  assert.deepEqual(journal.inputs_sha256, loaded.inputs, 'Packet input files changed after the local import; inspect before continuing');
}
