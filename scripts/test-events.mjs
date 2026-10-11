import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    let values = [];
    const query = {
      bind(...args) { values = args; return query; },
      async all() { return { results: statement.all(...values) }; },
      async first() { return statement.get(...values) ?? null; },
      async run() { return { meta: statement.run(...values) }; },
    };
    return query;
  },
  // Statements run in order, as a D1 batch does.
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
};
globalThis.__eventTestEnv = { DB: db };
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__eventTestEnv;')}`;
async function loadSource(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return { url, module: await import(url) };
}
const news = await loadSource('src/lib/news.ts');
const forum = await loadSource('src/lib/forum.ts');
const audit = await loadSource('src/lib/audit.ts');
const events = await loadSource('src/lib/events.ts', {
  './news': news.url,
  './ad-tracking': 'data:text/javascript,export const statDay = () => "2026-10-03";',
});
const { emptyEvent, saveEventFromForm, valuesFromEvent, copyOfEvent } = (await loadSource('src/lib/events-admin.ts', {
  './events': events.url, './news': news.url, './forum': forum.url, './audit': audit.url,
  './media': 'data:text/javascript,export const isMediaId = () => false;',
})).module;
const actor = { id: 'editor', name: 'Test editor' };
const save = (data, existing) => saveEventFromForm(data, existing, actor);
const { getAdminEvent, getEvent, listEvents, listEventsBetween, eventJsonLd } = events.module;
const form = (overrides = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...emptyEvent, title: 'Test event', summary: 'A verified event summary.',
    category: 'music', starts_on: '2026-10-10', start_time: '19:00', venue: 'Test theatre', community: 'Sandusky', ...overrides })) data.set(key, value);
  return data;
};
const markup = (event) => JSON.parse(eventJsonLd(event, 'https://example.test/events/test-event', null));

test('event admission and performers', async (t) => {
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
    if (!name.startsWith('0019') && !name.startsWith('0020')) database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  database.exec("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('editor', 'Test editor', 'editor@example.test', 1, '2026-10-01', '2026-10-01')");
  database.exec(`INSERT INTO events (id, slug, title, summary, category, starts_on, venue, community, cost, status, created_at, updated_at)
    VALUES ('existing', 'existing', 'Existing event', 'Existing summary', 'community', '2026-10-10', 'Test park', 'Sandusky', 'Free; rides extra', 'published', 123, 456)`);
  database.exec(readFileSync(new URL('../migrations/0019_event_offers_performers.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../migrations/0020_event_organizer_url.sql', import.meta.url), 'utf8'));

  await t.test('migration preserves existing content without inventing an offer or performer', async () => {
    const event = await getEvent('existing');
    assert.equal(event.cost, 'Free; rides extra');
    assert.equal(event.updated_at, 456);
    assert.equal(event.ticket_price, '');
    assert.equal(event.performer, '');
    assert.equal(event.organizer_url, '');
    assert.equal(markup(event).offers, undefined);
    assert.equal(markup(event).performer, undefined);
  });

  await t.test('paid offer survives saving, public reads, editing, and copying', async () => {
    const saved = await save(form({ status: 'published', performer: 'Test Quartet', ticket_price: '15.50',
      ticket_url: 'example.com/tickets', ticket_availability: 'InStock', end_time: '21:00',
      organizer: 'Test host', organizer_url: 'example.com/host' }), null);
    assert.equal(saved.ok, true);
    const event = await getEvent('test-event');
    const data = markup(event);
    assert.deepEqual(data.offers, { '@type': 'Offer', price: 15.5, priceCurrency: 'USD', url: 'https://example.com/tickets', availability: 'https://schema.org/InStock' });
    assert.deepEqual(data.performer, { '@type': 'PerformingGroup', name: 'Test Quartet' });
    assert.deepEqual(data.organizer, { '@type': 'Organization', name: 'Test host', url: 'https://example.com/host' });
    assert.equal(data.endDate, '2026-10-11T01:00:00.000Z');
    assert.equal((await listEvents({})).find((item) => item.id === saved.id).ticket_price, '15.50');
    const admin = await getAdminEvent(saved.id);
    assert.equal(valuesFromEvent(admin).ticket_price, '15.50');
    assert.equal(copyOfEvent(admin).performer, 'Test Quartet');
    assert.equal(valuesFromEvent(admin).organizer_url, 'https://example.com/host');
    assert.equal(copyOfEvent(admin).organizer_url, 'https://example.com/host');
    const edited = await save(form({ slug: event.slug, status: 'published', performer: 'Test Speaker', performer_type: 'Person', ticket_price: '0' }), admin);
    assert.equal(edited.ok, true);
    const updated = markup(await getEvent('test-event'));
    assert.deepEqual(updated.offers, { '@type': 'Offer', price: 0, priceCurrency: 'USD' });
    assert.deepEqual(updated.performer, { '@type': 'Person', name: 'Test Speaker' });
    assert.equal(updated.endDate, undefined);
    assert.equal(updated.image, undefined);
    assert.equal(updated.organizer, undefined);
  });

  await t.test('event saves are audited with status changes and changed field names, never details text', async () => {
    const rows = () => database.prepare("SELECT actor_id, actor_name, target_type, target_label, action, detail, outcome FROM admin_audit_log WHERE target_type = 'event' ORDER BY rowid").all().map((row) => ({ ...row }));
    const [created, published, updated] = rows();
    assert.deepEqual(created, { actor_id: 'editor', actor_name: 'Test editor', target_type: 'event', target_label: 'Test event', action: 'event-create', detail: '/events/test-event; published', outcome: 'success' });
    assert.equal(published.action, 'event-publish');
    assert.equal(updated.action, 'event-update');
    assert.match(updated.detail, /^Changed: .*performer.*ticket price/);
    assert.doesNotMatch(updated.detail, /summary|details/);
    database.exec('DELETE FROM admin_audit_log');
    const event = await getAdminEvent((await getEvent('test-event')).id);
    const values = valuesFromEvent(event);
    const same = () => form({ ...values, description: 'SECRET details text for the audit log' });
    assert.equal((await save(same(), event)).ok, true);
    assert.deepEqual(rows().map((row) => [row.action, row.detail]), [['event-update', 'Changed: details']]);
    database.exec('DELETE FROM admin_audit_log');
    const cancelled = await getAdminEvent(event.id);
    assert.equal((await save(form({ ...valuesFromEvent(cancelled), status: 'cancelled' }), cancelled)).ok, true);
    assert.deepEqual(rows().map((row) => row.action), ['event-cancel']);
    assert.doesNotMatch(JSON.stringify(rows()), /SECRET/);
    const after = await getAdminEvent(event.id);
    assert.equal((await save(form({ ...valuesFromEvent(after), status: 'cancelled' }), after)).ok, true);
    assert.equal(rows().length, 1);
    assert.equal((await save(form({ ...valuesFromEvent(after), title: 'X' }), after)).ok, false);
    assert.equal(rows().length, 1);
  });

  await t.test('invalid ticket data cannot save', async () => {
    for (const overrides of [
      { ticket_price: '-1' }, { ticket_price: '1.001' }, { ticket_price: '1e2' }, { ticket_price: '1000000' },
      { ticket_price: '12' }, { ticket_url: 'https://example.com/tickets' }, { ticket_availability: 'InStock' },
      { ticket_price: '0', ticket_url: 'javascript:alert(1)' },
      { ticket_price: '0', ticket_url: 'ftp://example.com/tickets' },
      { ticket_price: '0', ticket_url: 'https://user:password@example.com/tickets' },
      { ticket_price: '0', ticket_availability: 'Unknown' }, { performer_type: 'Organization' },
      { organizer_url: 'https://example.com/host' },
      { organizer: 'Test host', organizer_url: 'javascript:alert(1)' },
      { organizer: 'Test host', organizer_url: 'ftp://example.com/host' },
      { organizer: 'Test host', organizer_url: 'https://user:password@example.com/host' },
      { organizer: 'Test host', organizer_url: `https://example.com/${'a'.repeat(500)}` },
    ]) {
      const result = await save(form(overrides), null);
      assert.equal(result.ok, false, JSON.stringify(overrides));
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
  });

  await t.test('availability is explicit, unknown fields stay omitted, and script text is escaped', async () => {
    const event = await getEvent('test-event');
    for (const availability of ['SoldOut', 'PreOrder']) assert.equal(markup({ ...event, ticket_availability: availability }).offers.availability, `https://schema.org/${availability}`);
    const json = eventJsonLd({ ...event, performer: '</script><script>alert(1)</script>', organizer: 'Test host', link: 'https://example.com/details' }, 'https://example.test/events/test-event', 'https://example.test/media/photo.jpg');
    assert.equal(json.includes('</script>'), false);
    assert.deepEqual(JSON.parse(json).organizer, { '@type': 'Organization', name: 'Test host' });
    assert.deepEqual(JSON.parse(json).image, ['https://example.test/media/photo.jpg']);
  });

  await t.test('month view includes multi-day events that overlap the range and leaves out drafts', async () => {
    database.exec(`INSERT INTO events (id, slug, title, summary, category, starts_on, ends_on, venue, community, status, created_at, updated_at) VALUES
      ('spans', 'spans', 'Spanning festival', 'Summary', 'community', '2026-09-28', '2026-10-02', 'Test park', 'Huron', 'published', 1, 1),
      ('draft', 'draft', 'Draft event', 'Summary', 'community', '2026-10-15', NULL, 'Test park', 'Sandusky', 'draft', 1, 1),
      ('later', 'later', 'November event', 'Summary', 'community', '2026-11-01', NULL, 'Test park', 'Sandusky', 'published', 1, 1)`);
    const october = (await listEventsBetween({}, '2026-10-01', '2026-10-31')).map((e) => e.slug);
    assert.ok(october.includes('spans'));
    assert.ok(october.includes('existing'));
    assert.equal(october.includes('draft'), false);
    assert.equal(october.includes('later'), false);
    assert.deepEqual((await listEventsBetween({ community: 'Huron' }, '2026-10-01', '2026-10-31')).map((e) => e.slug), ['spans']);
    assert.deepEqual(await listEventsBetween({ category: 'music' }, '2026-09-01', '2026-09-30'), []);
  });
});
