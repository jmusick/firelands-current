import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Event submissions (issue #105): the public form endpoint, the staff queue actions, conversion to a draft
// event, the audit trail, and retention, using the site's own modules and the real migrations against an
// isolated in-memory database. Turnstile is simulated and no mail is sent.

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

// ---- Database ----

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(join(root, 'migrations')).sort()) database.exec(read(`migrations/${name}`));
function execute(statement, values) {
  if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
  return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
}
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    let values = [];
    const query = {
      bind(...args) { values = args; return query; },
      sync: () => execute(statement, values),
      async run() { return query.sync(); },
      async all() { return query.sync(); },
      async first() { return query.sync().results[0] ?? null; },
    };
    return query;
  },
  // A batch is one transaction, as on D1.
  async batch(statements) {
    database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.sync());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

const emails = [];
let failSend = false;
const realFetch = globalThis.fetch;
// How the simulated Turnstile answers: 'pass', 'fail' (a wrong answer), or a function that throws or answers oddly.
let siteverify = 'pass';
let verifyCalls = 0;
globalThis.__eventSubmissionEnv = {
  DB: db, BETTER_AUTH_SECRET: 'event-submission-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fixture-secret',
  EMAIL: { async send(message) {
    if (failSend) throw new Error('Simulated provider failure');
    emails.push(message);
    return { messageId: 'fixture-message' };
  } },
};
globalThis.fetch = async (url) => {
  verifyCalls++;
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  if (siteverify === 'pass') return Response.json({ success: true });
  if (siteverify === 'fail') return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  return siteverify();
};

// ---- Loading the site's own modules ----

const scratch = mkdtempSync(join(tmpdir(), 'firelands-event-submissions-'));
writeFileSync(join(scratch, 'cloudflare-workers.mjs'), 'export const env = globalThis.__eventSubmissionEnv;');
const loaded = new Map();
function importTarget(from, specifier) {
  if (specifier === 'cloudflare:workers') return pathToFileURL(join(scratch, 'cloudflare-workers.mjs')).href;
  if (!specifier.startsWith('.')) return import.meta.resolve(specifier);
  const base = posix.join(posix.dirname(from), specifier);
  const found = [`${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(join(root, candidate)));
  assert.ok(found, `${from} imports ${specifier}, which this test cannot load`);
  return load(found);
}
function transpile(path, source) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  return code.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => `from ${JSON.stringify(importTarget(path, specifier))}`);
}
/** A repository module as an importable URL. */
function load(path) {
  if (loaded.has(path)) return loaded.get(path);
  const file = join(scratch, `${path.replace(/[^\w.-]/g, '_')}.mjs`);
  const url = pathToFileURL(file).href;
  loaded.set(path, url);
  writeFileSync(file, transpile(path, read(path)));
  return url;
}
/** An .astro page's frontmatter as a function of Astro that returns its Response, or the values it would render. */
function loadPage(path) {
  const key = `${path}#page`;
  if (loaded.has(key)) return loaded.get(key);
  const file = join(scratch, `${key.replace(/[^\w.-]/g, '_')}.mjs`);
  const url = pathToFileURL(file).href;
  loaded.set(key, url);
  const frontmatter = read(path).split('---')[1];
  const imports = (frontmatter.match(/^import .*;\r?$/gm) ?? []).filter((line) => !/\.astro'|@lucide/.test(line));
  const body = frontmatter.replace(/^import .*;\r?$/gm, '');
  writeFileSync(file, transpile(path, `${imports.join('\n')}\nexport async function render(Astro) {\n${body}\nreturn { values, errors, fromSubmission, submissionId };\n}`));
  return url;
}
const { POST: submitPost } = await import(load('src/pages/api/event-submissions.ts'));
const { POST: reviewPost } = await import(load('src/pages/api/admin/event-submissions.ts'));
const { render: renderNewEvent } = await import(loadPage('src/pages/admin/events/new.astro'));
const retention = await import(load('src/lib/event-submission-retention.ts'));
const { validateEventSubmission } = await import(load('src/lib/event-submissions.ts'));
const { QUOTAS } = await import(load('src/lib/quotas.ts'));
const { CATEGORIES } = await import(load('src/lib/events.ts'));
const { runTipRetention } = await import(load('src/lib/tip-retention.ts'));

test.after(() => {
  globalThis.fetch = realFetch;
  database.close();
  rmSync(scratch, { recursive: true, force: true });
  delete globalThis.__eventSubmissionEnv;
});

// ---- Fixtures ----

const origin = 'https://firelandscurrent.com';
const DAY = 24 * 60 * 60 * 1000;
const easternDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const SECRET = { name: 'Quentin Organizer', email: 'quentin.secret@example.test', title: 'Zebra Parade on the Bay', note: 'Private note about the gate code 4471' };
const good = () => ({
  title: SECRET.title, summary: 'A parade of painted zebras along the water.', description: 'Bring a chair.\n\nRain or shine.', category: 'community',
  starts_on: easternDay(20), start_time: '18:00', ends_on: '', end_time: '20:30', venue: 'Jackson Street Pier', address: '1 Jackson St.',
  community: 'Sandusky', organizer: 'Bay Zebra Society', cost: 'Free', link: 'example.org/zebras', name: SECRET.name, email: SECRET.email, note: SECRET.note,
  'cf-turnstile-response': 'fixture-token',
});
let nextIp = 0;
function submit(overrides = {}, { ip = `198.51.100.${++nextIp % 250}`, requestOrigin = origin, user = null } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (requestOrigin) headers.Origin = requestOrigin;
  const request = new Request(`${origin}/api/event-submissions`, { method: 'POST', headers, body: new URLSearchParams({ ...good(), ...overrides }) });
  return submitPost({ request, locals: { user } });
}
const rows = (table) => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }));
const stored = () => rows('event_submissions');
const audit = () => rows('admin_audit_log');
const quietly = async (fn) => {
  const error = console.error;
  const log = console.log;
  console.error = () => {};
  console.log = () => {};
  try { return await fn(); } finally { console.error = error; console.log = log; }
};
test.beforeEach(() => {
  database.exec('DELETE FROM event_submissions; DELETE FROM admin_audit_log; DELETE FROM auth_rate_limits; DELETE FROM events; UPDATE scheduled_jobs SET last_run_at = 0');
  emails.length = 0; failSend = false; siteverify = 'pass'; verifyCalls = 0;
});

for (const [id, role] of [['editor', 'editor'], ['admin', 'admin'], ['moderator', 'moderator'], ['reader', null]]) {
  const stamp = new Date().toISOString();
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run(id, `${id} person`, `${id}@staff.example.test`, stamp, stamp);
  if (role) database.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?)').run(id, role, 1);
}
const actor = (id, staffRole) => ({ user: { id, name: `${id} person` }, staffRole });
const EDITOR = actor('editor', 'editor');

function review(fields, { who = EDITOR, requestOrigin = origin } = {}) {
  const headers = requestOrigin ? { Origin: requestOrigin } : {};
  const request = new Request(`${origin}/api/admin/event-submissions`, { method: 'POST', headers, body: new URLSearchParams(fields) });
  return reviewPost({ request, locals: { user: who.user, staffRole: who.staffRole } });
}
async function accepted(overrides = {}) {
  const response = await submit(overrides);
  assert.equal(response.status, 303);
  return stored().at(-1);
}

// ---- The public form ----

test('an accepted submission is stored for review, never written to events, and emailed with a review link and no contact details in the subject', async () => {
  const response = await submit();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `${origin}/submit-event?sent=1&o=1`);
  const [item] = stored();
  assert.equal(stored().length, 1);
  assert.deepEqual({ title: item.title, status: item.status, category: item.category, starts_on: item.starts_on, start_time: item.start_time, end_time: item.end_time, ends_on: item.ends_on, link: item.link, community: item.community },
    { title: SECRET.title, status: 'unread', category: 'community', starts_on: easternDay(20), start_time: '18:00', end_time: '20:30', ends_on: null, link: 'https://example.org/zebras', community: 'Sandusky' });
  assert.equal(item.name, SECRET.name);
  assert.equal(item.email, SECRET.email);
  assert.equal(item.event_id, null);
  assert.equal(rows('events').length, 0, 'drafts stay staff-made: nothing is written to events');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'news@firelandscurrent.com');
  assert.equal(emails[0].subject, `Event submission: ${SECRET.title}`);
  assert.ok(!emails[0].subject.includes(SECRET.email) && !emails[0].subject.includes(SECRET.name));
  assert.ok(emails[0].text.includes(`${origin}/admin/events/submissions/${item.id}`), 'the email links to the review page');
  assert.deepEqual(emails[0].replyTo, { email: SECRET.email, name: SECRET.name });
});

test('a failed notification email still leaves the submission stored', async () => {
  failSend = true;
  const response = await quietly(() => submit());
  assert.equal(response.headers.get('Location'), `${origin}/submit-event?sent=1&o=1`);
  assert.equal(stored().length, 1);
});

test('cross-origin and missing-origin posts are refused before anything is read', async () => {
  assert.equal((await submit({}, { requestOrigin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await submit({}, { requestOrigin: null })).status, 403);
  assert.equal(stored().length, 0);
  assert.equal(verifyCalls, 0);
});

test('invalid dates, end before start, and unknown categories are rejected with field names only', async () => {
  const back = (fields) => `${origin}/submit-event?error=invalid&fields=${fields}`;
  const cases = [
    [{ starts_on: '' }, 'starts_on'],
    [{ starts_on: 'next friday' }, 'starts_on'],
    [{ starts_on: '2030-02-31' }, 'starts_on'],
    [{ starts_on: '2030-13-01' }, 'starts_on'],
    [{ starts_on: easternDay(-3) }, 'starts_on'],
    [{ starts_on: easternDay(2000) }, 'starts_on'],
    [{ ends_on: easternDay(10) }, 'ends_on'],
    [{ ends_on: 'soon' }, 'ends_on'],
    [{ ends_on: easternDay(20 + 400) }, 'ends_on'],
    [{ start_time: '25:00' }, 'start_time'],
    [{ end_time: '17:00' }, 'end_time'],
    [{ end_time: '18:00' }, 'end_time'],
    [{ start_time: '', end_time: '19:00' }, 'end_time'],
    [{ category: 'nonsense' }, 'category'],
    [{ category: '' }, 'category'],
    [{ category: 'toString' }, 'category'],
    [{ link: 'javascript:alert(1)' }, 'link'],
    [{ link: 'https://user:pass@example.org/' }, 'link'],
    [{ email: 'not-an-email' }, 'email'],
    [{ email: 'a@example.com\r\nBcc: other@example.com' }, 'email'],
    [{ name: '' }, 'name'],
    [{ title: 'No' }, 'title'],
    [{ summary: 'Short' }, 'summary'],
    [{ venue: '' }, 'venue'],
    [{ community: '' }, 'community'],
    [{ note: 'n'.repeat(2001) }, 'note'],
    [{ description: 'd'.repeat(5001) }, 'description'],
  ];
  for (const [overrides, field] of cases) {
    const response = await submit(overrides);
    assert.equal(response.headers.get('Location'), back(field), JSON.stringify(overrides).slice(0, 80));
  }
  // Several problems are all reported, in page order; what was typed is never in the redirect.
  const response = await submit({ title: 'No', category: 'nonsense', starts_on: 'bad', email: 'bad' });
  assert.equal(response.headers.get('Location'), back('title,category,starts_on,email'));
  assert.ok(!response.headers.get('Location').includes('Zebra'));
  assert.equal(stored().length, 0);
  assert.equal(emails.length, 0);
  // Every category the calendar uses is accepted, and a same-day last day is a one-day event.
  for (const key of Object.keys(CATEGORIES)) assert.equal((await submit({ category: key })).headers.get('Location'), `${origin}/submit-event?sent=1&o=1`, key);
  const sameDay = await accepted({ ends_on: easternDay(20), start_time: '', end_time: '' });
  assert.equal(sameDay.ends_on, null);
  assert.equal(sameDay.start_time, null);
});

test('a several-day event may have daily hours that end before they start the day after', async () => {
  const item = await accepted({ ends_on: easternDay(22), start_time: '18:00', end_time: '09:00' });
  assert.equal(item.ends_on, easternDay(22));
  assert.equal(item.end_time, '09:00');
});

test('validateEventSubmission measures against the day it is given', () => {
  const form = new URLSearchParams(good());
  assert.equal(validateEventSubmission(form, easternDay(20)).ok, true);
  assert.deepEqual(validateEventSubmission(form, easternDay(21)).invalid, ['starts_on']);
});

test('an unreachable or broken human check fails closed, a wrong answer is rejected, and nothing is stored or sent', async () => {
  const unavailable = {
    'a timeout': () => { throw new DOMException('The operation timed out.', 'TimeoutError'); },
    'a network error': () => { throw new TypeError('fetch failed'); },
    'an HTTP failure': () => new Response('Bad gateway', { status: 502 }),
    'a non-JSON body': () => new Response('<html>Unavailable</html>', { status: 200 }),
    'an internal error': () => Response.json({ success: false, 'error-codes': ['internal-error'] }),
    'a rejected secret': () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }),
  };
  await quietly(async () => {
    for (const [name, answer] of Object.entries(unavailable)) {
      siteverify = answer;
      const response = await submit();
      assert.equal(response.status, 303, name);
      assert.equal(response.headers.get('Location'), `${origin}/submit-event?error=captcha_unavailable`, name);
    }
  });
  siteverify = 'fail';
  assert.equal((await submit()).headers.get('Location'), `${origin}/submit-event?error=captcha`);
  // A missing token never reaches Cloudflare.
  siteverify = 'pass';
  verifyCalls = 0;
  assert.equal((await submit({ 'cf-turnstile-response': '' })).headers.get('Location'), `${origin}/submit-event?error=captcha`);
  assert.equal(verifyCalls, 0);
  assert.equal(stored().length, 0);
  assert.equal(emails.length, 0);
});

test('the honeypot looks like success but stores and sends nothing, and does not report an outcome', async () => {
  const response = await submit({ website: 'https://spam.invalid' });
  assert.equal(response.headers.get('Location'), `${origin}/submit-event?sent=1`);
  assert.equal(verifyCalls, 0);
  assert.equal(stored().length, 0);
  assert.equal(emails.length, 0);
});

test('the quota stops a client after its allowance, keeps other clients separate, and refuses without storing', async () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < QUOTAS.event.max; i++) assert.equal((await submit({ title: `Event number ${i}` }, { ip })).headers.get('Location'), `${origin}/submit-event?sent=1&o=1`);
  const over = await submit({ title: 'One too many events' }, { ip });
  assert.equal(over.headers.get('Location'), `${origin}/submit-event?error=rate`);
  assert.equal(stored().length, QUOTAS.event.max);
  assert.equal(emails.length, QUOTAS.event.max);
  assert.equal((await submit({ title: 'From another place' }, { ip: '203.0.113.10' })).headers.get('Location'), `${origin}/submit-event?sent=1&o=1`);
  // Invalid fields and failed checks do not spend the allowance.
  const fresh = '203.0.113.20';
  for (let i = 0; i < QUOTAS.event.max + 2; i++) await submit({ category: 'nonsense' }, { ip: fresh });
  assert.equal((await submit({}, { ip: fresh })).headers.get('Location'), `${origin}/submit-event?sent=1&o=1`);
  // The window ends and the client is released.
  database.exec(`UPDATE auth_rate_limits SET window_start = window_start - ${QUOTAS.event.windowMs + 1000} WHERE key LIKE 'quota:event:%'`);
  assert.equal((await submit({ title: 'After the window' }, { ip })).headers.get('Location'), `${origin}/submit-event?sent=1&o=1`);
});

test('the event quota is separate from the shared mail-form allowance', () => {
  assert.notEqual(QUOTAS.event, QUOTAS.inbox);
  assert.ok(QUOTAS.event.windowMs <= 60 * 60 * 1000, 'a window longer than the counter retention would be pruned while in force');
});

// ---- The review queue ----

test('mark reviewed and decline move the submission once, start the retention clock, and are audited by id only', async () => {
  const item = await accepted();
  const reviewed = await review({ id: item.id, status: 'reviewed' });
  assert.equal(reviewed.status, 303);
  assert.equal(reviewed.headers.get('Location'), `${origin}/admin/events/submissions/${item.id}`);
  let now = stored()[0];
  assert.equal(now.status, 'reviewed');
  assert.ok(now.decided_at > 0);
  await review({ id: item.id, status: 'reviewed' });
  assert.equal(audit().filter((entry) => entry.action === 'event-submission-reviewed').length, 1, 'a repeated click adds nothing');
  await review({ id: item.id, status: 'declined' });
  now = stored()[0];
  assert.equal(now.status, 'declined');
  assert.equal(audit().filter((entry) => entry.action === 'event-submission-declined').length, 1);
  assert.deepEqual(audit().map((entry) => [entry.action, entry.target_type, entry.target_id, entry.actor_id, entry.detail]), [
    ['event-submission-reviewed', 'event-submission', item.id, 'editor', 'unread → reviewed'],
    ['event-submission-declined', 'event-submission', item.id, 'editor', 'reviewed → declined'],
  ]);
  assert.equal((await review({ id: item.id, status: 'bogus' })).status, 400);
  assert.equal((await review({ id: 'short', status: 'reviewed' })).status, 400);
});

test('the queue endpoint is for editors and administrators, and refuses cross-origin posts', async () => {
  const item = await accepted();
  const before = JSON.stringify(stored());
  const refused = [
    ['moderator', await review({ id: item.id, status: 'declined' }, { who: actor('moderator', 'moderator') })],
    ['reader', await review({ id: item.id, status: 'declined' }, { who: actor('reader', null) })],
    ['reader anonymize', await review({ id: item.id, action: 'anonymize' }, { who: actor('reader', null) })],
    ['cross-origin', await review({ id: item.id, status: 'declined' }, { requestOrigin: 'https://attacker.invalid' })],
    ['no origin', await review({ id: item.id, status: 'declined' }, { requestOrigin: null })],
  ];
  for (const [name, response] of refused) assert.equal(response.status, 403, name);
  const signedOut = await review({ id: item.id, status: 'declined' }, { who: { user: null, staffRole: null } });
  assert.equal(signedOut.status, 303);
  assert.match(signedOut.headers.get('Location'), /\/sign-in/);
  assert.equal(JSON.stringify(stored()), before);
  assert.equal((await review({ id: item.id, status: 'reviewed' }, { who: actor('admin', 'admin') })).status, 303);
  assert.equal(stored()[0].status, 'reviewed');
});

test('conversion opens the editor prefilled, creates a draft event, links the submission, and marks it converted', async () => {
  const item = await accepted({ ends_on: easternDay(22) });
  const astro = (method, search, fields) => {
    const url = new URL(`${origin}/admin/events/new${search}`);
    const init = { method, headers: { Origin: origin } };
    if (fields) init.body = new URLSearchParams(fields);
    return { request: new Request(url, init), url, locals: { ...EDITOR, cspNonce: 'n' }, redirect: (to, status) => new Response(null, { status, headers: { Location: to } }), params: {} };
  };
  const prefilled = await renderNewEvent(astro('GET', `?submission=${item.id}`));
  assert.equal(prefilled.fromSubmission, true);
  assert.deepEqual({ ...prefilled.values }, {
    title: SECRET.title, slug: '', summary: item.summary, description: item.description, category: 'community', starts_on: easternDay(20), start_time: '18:00',
    ends_on: easternDay(22), end_time: '20:30', hours_note: '', venue: 'Jackson Street Pier', address: '1 Jackson St.', community: 'Sandusky',
    organizer: 'Bay Zebra Society', organizer_url: '', cost: 'Free', link: 'https://example.org/zebras', performer: '', performer_type: 'PerformingGroup',
    ticket_price: '', ticket_url: '', ticket_availability: '', image_media_id: '', status: 'draft',
  });
  assert.equal(prefilled.values.title.includes(SECRET.name), false);
  assert.equal(rows('events').length, 0, 'opening the editor creates nothing');
  assert.equal(stored()[0].status, 'unread');

  // The editor posts the form, with the status chosen there: even "published" starts a converted event as a draft.
  const fields = { ...prefilled.values, status: 'published', submission_id: item.id };
  const saved = await renderNewEvent(astro('POST', `?submission=${item.id}`, fields));
  assert.equal(saved.status, 303);
  const [event] = rows('events');
  assert.equal(saved.headers.get('Location'), `/admin/events/${event.id}?saved=1`);
  assert.equal(event.status, 'draft');
  assert.equal(event.title, SECRET.title);
  assert.equal(event.venue, 'Jackson Street Pier');
  const linked = stored()[0];
  assert.equal(linked.status, 'converted');
  assert.equal(linked.event_id, event.id);
  assert.ok(linked.decided_at > 0);
  assert.deepEqual(audit().map((entry) => entry.action), ['event-create', 'event-submission-converted']);
  assert.equal(audit()[1].detail, `Event ${event.id}`);

  // A converted submission cannot be converted again, declined, or opened for conversion.
  const again = await renderNewEvent(astro('POST', `?submission=${item.id}`, { ...fields, title: 'A second draft from the same submission' }));
  assert.equal(again.status, 303);
  assert.equal(rows('events').length, 2);
  assert.equal(stored()[0].event_id, event.id, 'the first link stays');
  assert.equal(audit().filter((entry) => entry.action === 'event-submission-converted').length, 1);
  assert.equal((await review({ id: item.id, status: 'declined' })).status, 404);
  assert.equal((await renderNewEvent(astro('GET', `?submission=${item.id}`))).fromSubmission, false);

  // The draft publishes through the normal editor save, and deleting the event leaves the submission with no link.
  database.prepare("UPDATE events SET status = 'published' WHERE id = ?").run(event.id);
  database.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  assert.equal(stored()[0].event_id, null);
  assert.equal(stored()[0].status, 'converted');
});

test('a draft that fails the editor checks is not linked', async () => {
  const item = await accepted();
  const url = new URL(`${origin}/admin/events/new?submission=${item.id}`);
  const astro = { request: new Request(url, { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ title: 'x', submission_id: item.id }) }),
    url, locals: { ...EDITOR }, redirect: (to, status) => new Response(null, { status, headers: { Location: to } }), params: {} };
  const result = await renderNewEvent(astro);
  assert.ok(result.errors.length > 0);
  assert.equal(stored()[0].status, 'unread');
  assert.equal(rows('events').length, 0);
});

test('removing submitter details blanks name, email and note now, keeps the event, and is audited once', async () => {
  const item = await accepted();
  assert.equal((await review({ id: item.id, action: 'anonymize' })).status, 303);
  assert.equal((await review({ id: item.id, action: 'anonymize' })).status, 303);
  const [now] = stored();
  assert.deepEqual({ name: now.name, email: now.email, note: now.note, title: now.title, venue: now.venue }, { name: '', email: '', note: '', title: SECRET.title, venue: 'Jackson Street Pier' });
  assert.ok(now.anonymized_at > 0);
  assert.equal(audit().filter((entry) => entry.action === 'event-submission-anonymized').length, 1);
  assert.equal((await review({ id: 'missing-submission-id', action: 'anonymize' })).status, 404);
});

test('audit entries never contain the title, the submitter, their contact details, or the note', async () => {
  const one = await accepted();
  const two = await accepted({ title: 'Second Zebra Parade' });
  await review({ id: one.id, status: 'reviewed' });
  await review({ id: one.id, status: 'declined' });
  await review({ id: two.id, action: 'anonymize' });
  const astroUrl = new URL(`${origin}/admin/events/new?submission=${two.id}`);
  await renderNewEvent({ request: new Request(astroUrl, { method: 'POST', headers: { Origin: origin },
    body: new URLSearchParams({ ...good(), title: 'Second Zebra Parade', submission_id: two.id }) }), url: astroUrl, locals: { ...EDITOR },
    redirect: (to, status) => new Response(null, { status, headers: { Location: to } }), params: {} });
  const submissionEntries = audit().filter((entry) => entry.target_type === 'event-submission');
  assert.ok(submissionEntries.length >= 4);
  const text = JSON.stringify(submissionEntries);
  for (const secret of [SECRET.name, SECRET.email, 'quentin', SECRET.note, '4471', 'Zebra']) assert.ok(!text.includes(secret), `audit log leaked ${secret}`);
  assert.ok(submissionEntries.every((entry) => /^Event submission /.test(entry.target_label)));
  // The retention job's entry holds counts only.
  await quietly(() => retention.runEventSubmissionRetention(db));
  assert.ok(!JSON.stringify(audit()).includes('example.test'));
});

// ---- Retention ----

const NOW = Date.UTC(2026, 10, 15, 8);
function insert(id, { status = 'unread', decidedDaysAgo = null, createdDaysAgo = 500, anonymized = null, event = null } = {}) {
  database.prepare(`INSERT INTO event_submissions (id, title, summary, category, starts_on, venue, community, name, email, note, status, event_id,
      decided_at, anonymized_at, created_at, updated_at) VALUES (?, ?, 'Summary text here', 'community', '2027-01-01', 'Hall', 'Sandusky', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, `Title ${id}`, `Name ${id}`, `${id}@example.test`, `Note ${id}`, status, event,
      decidedDaysAgo === null ? null : NOW - decidedDaysAgo * DAY, anonymized, NOW - createdDaysAgo * DAY, NOW - createdDaysAgo * DAY);
}
const byId = () => Object.fromEntries(stored().map((row) => [row.id, row]));

test('retention constants mirror news tips: 90 days declined, a year reviewed or converted', () => {
  assert.equal(retention.DECLINED_SUBMISSION_RETENTION_MS, 90 * DAY);
  assert.equal(retention.SUBMISSION_CONTACT_RETENTION_MS, 365 * DAY);
  assert.equal(retention.STALE_UNREAD_SUBMISSION_MS, 90 * DAY);
});

test('declined submissions are deleted 90 days after the decline, not after they arrived', async () => {
  insert('declined-old', { status: 'declined', decidedDaysAgo: 91 });
  insert('declined-edge', { status: 'declined', decidedDaysAgo: 90 });
  insert('declined-recent', { status: 'declined', decidedDaysAgo: 89, createdDaysAgo: 600 });
  const result = await retention.applyEventSubmissionRetention(db, NOW);
  assert.deepEqual({ deleted: result.deleted, anonymized: result.anonymized }, { deleted: 1, anonymized: 0 });
  assert.deepEqual(Object.keys(byId()), ['declined-edge', 'declined-recent']);
  await retention.applyEventSubmissionRetention(db, NOW + 1);
  assert.deepEqual(Object.keys(byId()), ['declined-recent']);
});

test('reviewed and converted submissions lose contact details after a year and keep the event details; nothing else is touched', async () => {
  database.prepare(`INSERT INTO events (id, slug, title, summary, category, starts_on, venue, community, status, created_at, updated_at)
    VALUES ('event-for-retention', 'retained-event', 'Retained event', 'Summary', 'community', '2027-01-01', 'Hall', 'Sandusky', 'draft', 1, 1)`).run();
  insert('reviewed-old', { status: 'reviewed', decidedDaysAgo: 366 });
  insert('converted-old', { status: 'converted', decidedDaysAgo: 400, event: 'event-for-retention' });
  insert('reviewed-recent', { status: 'reviewed', decidedDaysAgo: 364 });
  insert('unread-ancient', { status: 'unread', createdDaysAgo: 2000 });
  insert('declined-fresh', { status: 'declined', decidedDaysAgo: 5 });
  const before = byId();
  const result = await retention.applyEventSubmissionRetention(db, NOW);
  assert.deepEqual({ deleted: result.deleted, anonymized: result.anonymized, staleUnread: result.staleUnread }, { deleted: 0, anonymized: 2, staleUnread: 1 });
  const after = byId();
  for (const id of ['reviewed-old', 'converted-old']) {
    assert.deepEqual({ name: after[id].name, email: after[id].email, note: after[id].note, anonymized_at: after[id].anonymized_at }, { name: '', email: '', note: '', anonymized_at: NOW });
    assert.equal(after[id].title, before[id].title);
    assert.equal(after[id].status, before[id].status);
    assert.equal(after[id].decided_at, before[id].decided_at);
  }
  assert.equal(after['converted-old'].event_id, 'event-for-retention');
  for (const id of ['reviewed-recent', 'unread-ancient', 'declined-fresh']) assert.deepEqual(after[id], before[id], id);
  assert.equal(rows('events').length, 1, 'the converted event is a separate record');
  // Re-running changes nothing, and writes no second audit entry.
  const entries = audit().length;
  const again = await retention.applyEventSubmissionRetention(db, NOW + 1000);
  assert.deepEqual({ deleted: again.deleted, anonymized: again.anonymized }, { deleted: 0, anonymized: 0 });
  assert.deepEqual(byId()['reviewed-old'], after['reviewed-old']);
  assert.equal(audit().length, entries);
});

test('a decline restarts the clock, and unread submissions are only flagged', async () => {
  insert('was-reviewed', { status: 'declined', decidedDaysAgo: 2, createdDaysAgo: 900 });
  insert('stale-unread', { status: 'unread', createdDaysAgo: 91 });
  insert('fresh-unread', { status: 'unread', createdDaysAgo: 89 });
  const result = await retention.applyEventSubmissionRetention(db, NOW);
  assert.deepEqual({ deleted: result.deleted, anonymized: result.anonymized, staleUnread: result.staleUnread }, { deleted: 0, anonymized: 0, staleUnread: 1 });
  assert.equal(stored().length, 3);
  assert.deepEqual(retention.submissionRetentionDates({ status: 'declined', decided_at: NOW, anonymized_at: null }), { deletesAt: NOW + 90 * DAY, anonymizesAt: null });
  assert.deepEqual(retention.submissionRetentionDates({ status: 'converted', decided_at: NOW, anonymized_at: null }), { deletesAt: null, anonymizesAt: NOW + 365 * DAY });
  assert.deepEqual(retention.submissionRetentionDates({ status: 'unread', decided_at: null, anonymized_at: null }), { deletesAt: null, anonymizesAt: null });
});

test('each run is bounded, hands its claim back when a batch was full, and the audit entry holds counts only', async () => {
  const total = retention.SUBMISSION_RETENTION_BATCH + 5;
  for (let i = 0; i < total; i++) insert(`declined-${String(i).padStart(4, '0')}`, { status: 'declined', decidedDaysAgo: 100 + i % 50 });
  const first = await quietly(() => retention.runEventSubmissionRetention(db, NOW));
  assert.equal(first.deleted, retention.SUBMISSION_RETENTION_BATCH);
  assert.equal(first.more, true);
  assert.equal(stored().length, 5);
  // The claim went back, so the next cron run finishes the work.
  const second = await quietly(() => retention.runEventSubmissionRetention(db, NOW + 5 * 60 * 1000));
  assert.equal(second.deleted, 5);
  const entries = audit().filter((entry) => entry.action === 'event-submission-retention');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => [entry.actor_id, entry.target_id]), [[null, null], [null, null]]);
  assert.match(entries[0].detail, /^Deleted 200 declined event submissions past 90 days$/);
  assert.ok(!entries.some((entry) => /declined-|Title|example\.test/.test(JSON.stringify(entry))));
});

test('the job runs at most once a day under its own claim, separate from tip retention', async () => {
  insert('declined-old', { status: 'declined', decidedDaysAgo: 120 });
  assert.deepEqual({ ...database.prepare("SELECT last_run_at FROM scheduled_jobs WHERE name = 'event-submission-retention'").get() }, { last_run_at: 0 });
  const first = await quietly(() => retention.runEventSubmissionRetention(db, NOW));
  assert.equal(first.deleted, 1);
  assert.equal(await quietly(() => retention.runEventSubmissionRetention(db, NOW + 60 * 60 * 1000)), null, 'not due again the same day');
  insert('declined-later', { status: 'declined', decidedDaysAgo: 400 });
  assert.equal(await quietly(() => retention.runEventSubmissionRetention(db, NOW + DAY - 1)), null);
  const next = await quietly(() => retention.runEventSubmissionRetention(db, NOW + DAY));
  assert.equal(next.deleted, 1);
  // Claiming one job leaves the other's claim alone.
  assert.deepEqual({ ...database.prepare("SELECT last_run_at FROM scheduled_jobs WHERE name = 'tip-retention'").get() }, { last_run_at: 0 });
  assert.ok(await quietly(() => runTipRetention(db, NOW + DAY)), 'tip retention still runs on its own claim');
});

test('a failed run hands the claim back and the error reaches the caller', async () => {
  insert('declined-old', { status: 'declined', decidedDaysAgo: 120 });
  const failing = {
    prepare(sql) {
      if (/DELETE FROM event_submissions/.test(sql)) throw new Error('Simulated D1 failure');
      return db.prepare(sql);
    },
    batch: (statements) => db.batch(statements),
  };
  await quietly(async () => {
    await assert.rejects(() => retention.runEventSubmissionRetention(failing, NOW), /Simulated D1 failure/);
  });
  assert.deepEqual({ ...database.prepare("SELECT last_run_at FROM scheduled_jobs WHERE name = 'event-submission-retention'").get() }, { last_run_at: NOW - DAY });
  assert.ok(await quietly(() => retention.runEventSubmissionRetention(db, NOW + 1)), 'the next run is due');
});

// ---- Wiring ----

test('the scheduled Worker runs the job with its own catch, and the migration seeds its claim', () => {
  assert.match(read('src/worker.ts'), /await runEventSubmissionRetention\(env\.DB\)\.catch\(\(\) => console\.error\(JSON\.stringify\(\{ event: 'event_submission_retention_failed' \}\)\)\);/);
  assert.match(read('migrations/0036_event_submissions.sql'), /INSERT INTO scheduled_jobs \(name, last_run_at\) VALUES \('event-submission-retention', 0\)/);
});

test('the form is linked from /events and the footer, is noindex with no ads, and reports one outcome event', () => {
  assert.match(read('src/pages/events/index.astro'), /href="\/submit-event"[^>]*>Submit an event</);
  assert.match(read('src/layouts/BaseLayout.astro'), /<a href="\/submit-event">Submit an event<\/a>/);
  const page = read('src/pages/submit-event.astro');
  assert.match(page, /<BaseLayout[^>]*\bnoindex\b/);
  assert.doesNotMatch(read('src/lib/sitemap.ts'), /submit-event/);
  assert.match(read('src/lib/ads.ts'), /submit-event/);
  assert.match(read('src/scripts/outcome-events.ts'), /'\/submit-event': \{ name: 'event_submitted', form: 'event' \}/);
  const form = read('src/components/EventSubmissionForm.astro');
  assert.match(form, /name="website"/, 'honeypot');
  assert.match(form, /<Turnstile action="event-submission"/);
  assert.doesNotMatch(form, /type="file"/, 'images go through the media library');
});
