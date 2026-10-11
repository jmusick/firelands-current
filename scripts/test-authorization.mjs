import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword } from 'better-auth/crypto';

// Authorization regressions: who may reach each endpoint and page, with the real middleware, Better Auth
// sessions, route modules, and migrations, against an isolated in-memory database. Covers signed-out
// visitors, every staff role, suspended accounts, business members probing another business, and the
// session cookie's attributes. Routes are listed in one table, and a source check fails when an endpoint
// exists that the table does not name, so a new route cannot ship without choosing its guard here.

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

// ---- Database ----

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(join(root, 'migrations')).sort()) database.exec(read(`migrations/${name}`));
// A D1 stand-in: a batch is one transaction, and writes report how many rows they changed.
function execute(statement, values) {
  if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
  return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
}
const db = {
  exec: (sql) => database.exec(sql),
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
const origin = 'http://localhost:4321';
const deletedObjects = [];
globalThis.__authorizationEnv = {
  DB: db, SITE_URL: origin, BETTER_AUTH_SECRET: 'authorization-regression-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fixture-secret',
  MEDIA: { async delete(key) { deletedObjects.push(key); }, async get() { return null; }, async put() { throw new Error('unexpected upload'); } },
};
if (typeof globalThis.HTMLRewriter === 'undefined') {
  // The Workers runtime's HTML transformer; the nonce rewrite it performs is covered by test-response-headers.
  globalThis.HTMLRewriter = class { on() { return this; } transform(response) { return response; } };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => assert.fail(`unexpected network request to ${url}`);

// ---- Loading the site's own modules ----

// The endpoints share a graph of about fifty modules, so each is transpiled once into a temporary directory
// and imported from there (a data: URL per module would embed every dependency again inside each importer).
// `cloudflare:workers` and `astro:middleware` are replaced with stubs; everything else is the real source.
const scratch = mkdtempSync(join(tmpdir(), 'firelands-authorization-'));
writeFileSync(join(scratch, 'cloudflare-workers.mjs'), 'export const env = globalThis.__authorizationEnv;');
writeFileSync(join(scratch, 'astro-middleware.mjs'), 'export const defineMiddleware = (handler) => handler;');
const loaded = new Map();
function importTarget(from, specifier) {
  if (specifier === 'cloudflare:workers') return pathToFileURL(join(scratch, 'cloudflare-workers.mjs')).href;
  if (specifier === 'astro:middleware') return pathToFileURL(join(scratch, 'astro-middleware.mjs')).href;
  if (!specifier.startsWith('.')) return import.meta.resolve(specifier);
  const base = posix.join(posix.dirname(from), specifier);
  const found = [`${base}.ts`, `${base}/index.ts`, base].find((candidate) => candidate.endsWith('.ts') && existsSync(join(root, candidate)));
  assert.ok(found, `${from} imports ${specifier}, which this test cannot load`);
  return load(found);
}
/** A repository module as an importable URL. `page` runs an .astro page's frontmatter, as test-auth.mjs does. */
function load(path, page = false) {
  const key = page ? `${path}#page` : path;
  if (loaded.has(key)) return loaded.get(key);
  const file = join(scratch, `${key.replace(/[^\w.-]/g, '_')}.mjs`);
  const url = pathToFileURL(file).href;
  loaded.set(key, url);
  let source = read(path);
  if (page) {
    const frontmatter = source.split('---')[1];
    const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
    source = `${imports.join('\n')}\nexport async function render(Astro) {\n${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn new Response('Authorized');\n}`;
  }
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replaceAll('import.meta.env', '({ DEV: false })');
  code = code.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => `from ${JSON.stringify(importTarget(path, specifier))}`);
  writeFileSync(file, code);
  return url;
}
const { createAuth } = await import(load('src/lib/auth.ts'));
const { onRequest } = await import(load('src/middleware.ts'));
const { ADMIN, canAccess, requireSection, sectionsFor } = await import(load('src/lib/admin.ts'));
const { ROLE_LABELS } = await import(load('src/lib/staff.ts'));
const { recordReauth } = await import(load('src/lib/reauth.ts'));
const { signEvent } = await import(load('src/lib/ad-tracking.ts'));
const { handleAuthRequest } = await import(load('src/lib/auth-events.ts'));

test.after(() => {
  globalThis.fetch = originalFetch;
  database.close();
  rmSync(scratch, { recursive: true, force: true });
  delete globalThis.__authorizationEnv;
});

// ---- Accounts and content ----

const password = 'authorization-fixture-password';
const passwordHash = await hashPassword(password);
const stamp = new Date().toISOString();
function addUser(id, role = null) {
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run(id, id, `${id}@example.test`, stamp, stamp);
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
    .run(id, id, id, passwordHash, stamp, stamp);
  if (role) database.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?)').run(id, role, Date.now());
}
for (const [id, role] of [['reader'], ['owner'], ['moderator', 'moderator'], ['editor', 'editor'], ['admin', 'admin'], ['gone', 'admin'], ['victim']]) addUser(id, role);

const now = Date.now();
const fx = {
  businessA: 'business-a', businessB: 'business-b', adA: 'ad-a-live', adADraft: 'ad-a-draft', adB: 'ad-b-live', adBDraft: 'ad-b-draft',
  story: 'story-fixture-1', event: 'event-fixture-1', media: 'media-fixture-1', tip: 'tip-fixture-1', correction: 'correction-fixture-1',
  thread: crypto.randomUUID(), report: crypto.randomUUID(),
};
for (const [id, name] of [[fx.businessA, 'Alpha Bakery'], [fx.businessB, 'Bravo Hardware']]) {
  database.prepare("INSERT INTO businesses (id, name, kind, status, created_at, updated_at) VALUES (?, ?, 'advertiser', 'active', ?, ?)").run(id, name, now, now);
}
database.prepare("INSERT INTO business_members (business_id, user_id, role, created_at) VALUES (?, 'owner', 'owner', ?)").run(fx.businessA, now);
for (const [id, business, status] of [[fx.adA, fx.businessA, 'active'], [fx.adADraft, fx.businessA, 'draft'], [fx.adB, fx.businessB, 'active'], [fx.adBDraft, fx.businessB, 'draft']]) {
  database.prepare(`INSERT INTO ads (id, business_id, name, status, headline, cta, href, theme_bg, theme_fg, theme_accent, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Headline', 'Visit', 'https://example.com/offer', '#fff', '#000', '#00f', ?, ?)`).run(id, business, `Ad ${id}`, status, now, now);
}
database.prepare(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, published_at, created_at, updated_at)
  VALUES (?, 'fixture-story', 'Fixture story', 'Summary', 'Body', 'local', 'Sandusky', 'Staff', 'published', ?, ?, ?)`).run(fx.story, now, now, now);
database.prepare(`INSERT INTO events (id, slug, title, summary, category, starts_on, venue, community, status, created_at, updated_at)
  VALUES (?, 'fixture-event', 'Fixture event', 'Summary', 'community', '2030-01-01', 'Hall', 'Sandusky', 'published', ?, ?)`).run(fx.event, now, now);
database.prepare(`INSERT INTO community_links (id, name, url, county, category, status, checked_on, created_at, updated_at)
  VALUES ('link-fixture-1', 'Fixture county', 'https://example.test/', 'erie', 'government', 'published', '2026-01-01', ?, ?)`).run(now, now);
database.prepare(`INSERT INTO media (id, object_key, content_type, width, height, bytes, filename, credit, created_at, updated_at)
  VALUES (?, 'library/fixture.png', 'image/png', 10, 10, 100, 'fixture.png', 'Fixture credit', ?, ?)`).run(fx.media, now, now);
database.prepare(`INSERT INTO news_submissions (id, name, email, subject, body, status, created_at, updated_at)
  VALUES (?, 'Tipster', 'tipster@example.test', 'A tip', 'Tip text', 'unread', ?, ?)`).run(fx.tip, now, now);
database.prepare(`INSERT INTO corrections (id, kind, article_id, item_title, item_slug, name, email, details, created_at, updated_at)
  VALUES (?, 'news', ?, 'Fixture story', 'fixture-story', 'Reader', 'reader@example.test', 'A detail is wrong.', ?, ?)`).run(fx.correction, fx.story, now, now);
database.prepare('INSERT INTO forum_threads (id, author_id, title, body, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(fx.thread, 'victim', 'Fixture discussion', 'Fixture body for the discussion.', now, now, now);
database.prepare("INSERT INTO forum_reports (id, reporter_id, thread_id, reason, created_at) VALUES (?, 'reader', ?, 'Fixture report reason', ?)").run(fx.report, fx.thread, now);
// Existing bios, so an unauthorized overwrite or clear changes the snapshot.
for (const id of ['admin', 'editor']) database.prepare('INSERT INTO staff_bios (user_id, bio, updated_at) VALUES (?, ?, ?)').run(id, `Original bio of ${id}.`, now);

// ---- Requests ----

let addresses = 0;
const freshIp = () => { assert.ok(++addresses < 255); return `192.0.2.${addresses}`; };
const auth = createAuth();
const authPost = (path, body, { cookie = '', instance = auth, site = origin } = {}) => instance.handler(new Request(`${site}/api/auth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: site, cookie, 'cf-connecting-ip': freshIp() }, body: JSON.stringify(body),
}));
const cookieHeader = (response) => response.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
async function signIn(id) {
  const response = await authPost('sign-in/email', { email: `${id}@example.test`, password });
  assert.equal(response.status, 200, `sign-in for ${id}`);
  return cookieHeader(response);
}

/** The people the matrix runs as. `role` is what the database says; `effective` is what the site should grant. */
const ACTORS = {
  signedOut: { cookie: '', role: null, signedIn: false },
  reader: { id: 'reader', role: null, signedIn: true },
  businessOwner: { id: 'owner', role: null, signedIn: true },
  moderator: { id: 'moderator', role: 'moderator', signedIn: true },
  editor: { id: 'editor', role: 'editor', signedIn: true },
  admin: { id: 'admin', role: 'admin', signedIn: true },
  // A staff account suspended after its session was opened, as when a suspension and a request overlap.
  suspendedAdmin: { id: 'gone', role: 'admin', signedIn: false },
};
for (const actor of Object.values(ACTORS)) {
  if (actor.id) actor.cookie = await signIn(actor.id);
  actor.effective ??= actor.signedIn ? actor.role : null;
}
database.prepare("INSERT INTO user_suspensions (user_id, reason, created_at) VALUES ('gone', 'Fixture suspension', ?)").run(now);

const form = (fields) => new URLSearchParams(fields);
const redirect = (location, status = 302) => new Response(null, { status, headers: { Location: location } });
/** Runs a request through the site middleware and then the route, as the Worker does. */
async function call(actor, route, spec = {}, headers = {}) {
  const method = spec.method ?? route.method ?? 'POST';
  const url = new URL(`${spec.path ?? route.path}${spec.search ?? ''}`, origin);
  const init = { method, headers: { origin, cookie: actor.cookie, 'cf-connecting-ip': '198.51.100.7', 'user-agent': 'Mozilla/5.0', ...headers } };
  if (method !== 'GET') init.body = spec.fields ? form(spec.fields) : spec.text;
  const request = new Request(url, init);
  if (headers.origin === null) request.headers.delete('origin');
  const context = { request, url, locals: {}, params: spec.params ?? {}, redirect };
  const module = await import(load(route.file));
  return onRequest(context, () => module[method](context));
}
// Redirects built with Response.redirect are absolute; compare the path and query only.
const location = (response) => {
  const target = response.headers.get('Location');
  if (!target) return '';
  const url = new URL(target, origin);
  return url.origin === origin ? `${url.pathname}${url.search}` : url.href;
};
const toSignIn = (response) => response.status === 303 && location(response).startsWith('/sign-in');

/** Every table except the audit log and rate counters, which legitimately change when a request is refused. */
function snapshot() {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('admin_audit_log', 'auth_rate_limits') ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => [name, database.prepare(`SELECT * FROM "${name}"`).all()]));
}

// ---- The route table ----

// What each section should allow, written out here rather than read from ADMIN, so a change to who can
// reach a section has to be made in two places and reviewed.
const SECTION_ROLES = {
  dashboard: ['admin', 'editor', 'moderator'],
  news: ['admin', 'editor'], facebook: ['admin', 'editor'], submissions: ['admin', 'editor'], corrections: ['admin', 'editor'],
  events: ['admin', 'editor'], links: ['admin', 'editor'], media: ['admin', 'editor'],
  talk: ['admin', 'moderator'],
  users: ['admin'], businesses: ['admin'], ads: ['admin'],
};
const ADMIN_ONLY = ['admin'];

// kind: 'staff'   needs one of `roles`; refusals are 403, and a signed-in refusal is recorded under `audit`
//       'member'  needs any signed-in, unsuspended account
//       'open'    anyone, with only the same-origin rule (forms that carry their own Turnstile and quota)
// `attacks` are requests that would change data or return it if the guard failed; they are sent as every
// actor who must be refused. `probe` is a harmless request sent as everyone who must get through, and `answer`
// is what getting through looks like. `body` names the first body read, which the guard must precede.
const ROUTES = [
  { file: 'src/pages/api/admin/ads.ts', path: '/api/admin/ads', kind: 'staff', roles: SECTION_ROLES.ads, guard: 'ads', audit: 'ad-admin',
    attacks: [{ fields: { action: 'delete', adId: fx.adB, confirm: `Ad ${fx.adB}` } }, { fields: { action: 'activate', adId: fx.adBDraft } }],
    probe: { fields: { action: 'pause', adId: 'missing' } }, answer: { status: 404 } },
  { file: 'src/pages/api/admin/businesses.ts', path: '/api/admin/businesses', kind: 'staff', roles: SECTION_ROLES.businesses, guard: 'businesses', audit: 'business-admin',
    attacks: [
      { fields: { action: 'add-member', businessId: fx.businessB, userId: 'owner', role: 'owner' } },
      { fields: { action: 'delete', businessId: fx.businessB, confirm: 'Bravo Hardware' } },
      { fields: { action: 'archive', businessId: fx.businessA } },
    ],
    probe: { fields: { action: 'archive', businessId: 'missing' } }, answer: { status: 404 } },
  { file: 'src/pages/api/admin/corrections.ts', path: '/api/admin/corrections', kind: 'staff', roles: SECTION_ROLES.corrections, guard: 'corrections', audit: 'correction-resolve',
    attacks: [{ fields: { id: fx.correction, action: 'corrected', note: 'Fixed.' } }],
    probe: { fields: { id: 'short', action: 'corrected' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/events.ts', path: '/api/admin/events', kind: 'staff', roles: ADMIN_ONLY, guard: 'admin-only', audit: 'event-delete',
    attacks: [{ fields: { action: 'delete', id: fx.event } }],
    probe: { fields: { action: 'bogus' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/links.ts', path: '/api/admin/links', kind: 'staff', roles: SECTION_ROLES.links, guard: 'links', audit: 'link-delete',
    attacks: [{ fields: { action: 'delete', id: 'link-fixture-1', confirm: 'DELETE' } }],
    probe: { fields: { action: 'bogus' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/facebook/resolve.ts', path: '/api/admin/facebook/resolve', kind: 'staff', roles: SECTION_ROLES.facebook, guard: 'facebook', audit: 'facebook-resolve',
    attacks: [{ fields: { id: fx.story, action: 'record', post_id: '1_2', checked_page: '1' } }],
    probe: { fields: { id: 'bad id!', action: 'queue' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/media.ts', path: '/api/admin/media', kind: 'staff', roles: SECTION_ROLES.media, guard: 'media', audit: 'media-admin',
    attacks: [{ fields: { action: 'delete', mediaId: fx.media } }],
    probe: { fields: { action: 'bogus' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/media.ts', path: '/api/admin/media', method: 'GET', kind: 'staff', roles: SECTION_ROLES.media, guard: 'media', audit: null,
    attacks: [{ search: '?page=1' }], probe: { search: '?page=not-a-number' }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/news/delete.ts', path: '/api/admin/news/delete', kind: 'staff', roles: ADMIN_ONLY, guard: 'admin-only', audit: 'story-delete',
    attacks: [{ fields: { id: fx.story } }],
    probe: { fields: { id: '' } }, answer: { status: 303, location: /^\/admin\/news\?deleted=1$/ } },
  { file: 'src/pages/api/admin/news/preview.ts', path: '/api/admin/news/preview', kind: 'staff', roles: SECTION_ROLES.news, guard: 'news', audit: null,
    attacks: [{ text: 'Unpublished draft text' }], probe: { text: 'Story' }, answer: { status: 200 } },
  { file: 'src/pages/api/admin/submissions.ts', path: '/api/admin/submissions', kind: 'staff', roles: SECTION_ROLES.submissions, guard: 'submissions', audit: 'tip-review',
    attacks: [{ fields: { id: fx.tip, action: 'anonymize' } }, { fields: { id: fx.tip, status: 'declined' } }],
    probe: { fields: { id: 'short' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/talk.ts', path: '/api/admin/talk', kind: 'staff', roles: SECTION_ROLES.talk, guard: 'talk', audit: 'talk-moderate',
    attacks: [{ fields: { action: 'hide-thread', threadId: fx.thread } }, { fields: { action: 'hide-reported', reportId: fx.report } }],
    probe: { fields: { action: 'bogus' } }, answer: { status: 400 } },
  { file: 'src/pages/api/admin/users.ts', path: '/api/admin/users', kind: 'staff', roles: SECTION_ROLES.users, guard: 'users', audit: 'user-admin',
    attacks: [
      { fields: { action: 'set-role', userId: 'owner', role: 'admin' } },
      { fields: { action: 'set-role', userId: 'reader', role: 'editor' } },
      { fields: { action: 'suspend', userId: 'victim', reason: 'Fixture', duration: '1' } },
      { fields: { action: 'set-password', userId: 'victim', password: 'attacker-chosen-password-1' } },
      { fields: { action: 'revoke-sessions', userId: 'admin' } },
      { fields: { action: 'delete', userId: 'victim', confirm: 'victim@example.test' } },
      { fields: { action: 'create', name: 'Mallory', email: 'mallory@example.test', password: 'attacker-chosen-password-2', role: 'admin' } },
    ],
    probe: { fields: { action: 'bogus', userId: 'missing' } }, answer: { status: 404 } },

  // /api/bio is two rules in one handler: any staff role sets its own bio, and another user's needs the Users section.
  { file: 'src/pages/api/bio.ts', path: '/api/bio', kind: 'staff', roles: SECTION_ROLES.dashboard, guard: 'any-staff', audit: null,
    attacks: [{ fields: { bio: 'Written by someone with no staff role.' } }, { fields: { userId: 'reader', bio: 'Written by someone with no staff role.' } }],
    probe: { fields: { bio: 'x'.repeat(601) } }, answer: { status: 303, location: /^\/account\?bioError=too-long$/ } },
  { file: 'src/pages/api/bio.ts', path: '/api/bio', kind: 'staff', roles: SECTION_ROLES.users, guard: 'users', mixed: true, audit: null,
    attacks: [{ fields: { userId: 'admin', bio: 'Hijacked.' } }, { fields: { userId: 'admin', bio: '' } }, { fields: { userId: 'victim', bio: 'Hijacked.' } }],
    probe: { fields: { userId: 'victim', bio: 'x' } }, answer: { status: 400 } },

  { file: 'src/pages/api/talk/threads.ts', path: '/api/talk/threads', kind: 'member',
    attacks: [{ fields: { title: 'A valid discussion title', body: 'A valid discussion body that is long enough.' } }],
    probe: { fields: { title: 'short', body: 'short' } }, answer: { status: 303, location: /^\/talk\/new\?error=length$/ } },
  { file: 'src/pages/api/talk/replies.ts', path: '/api/talk/replies', kind: 'member',
    attacks: [{ fields: { threadId: fx.thread, body: 'A valid reply.' } }],
    probe: { fields: { threadId: 'nope', body: 'A valid reply.' } }, answer: { status: 400 } },
  { file: 'src/pages/api/talk/reports.ts', path: '/api/talk/reports', kind: 'member',
    attacks: [{ fields: { kind: 'thread', id: fx.thread, reason: 'A valid reason for reporting.' } }],
    probe: { fields: { kind: 'nope' } }, answer: { status: 400 } },
  { file: 'src/pages/api/talk/votes.ts', path: '/api/talk/votes', kind: 'member',
    attacks: [{ fields: { kind: 'thread', id: fx.thread, vote: 'up' } }],
    probe: { fields: { kind: 'nope' } }, answer: { status: 400 } },
  { file: 'src/pages/api/reauth.ts', path: '/api/reauth', kind: 'member',
    attacks: [{ fields: { password, next: '/admin' } }],
    probe: { fields: { password: '', next: '/admin' } }, answer: { status: 303, location: /^\/reauth\?next=%2Fadmin&error=password$/ } },

  { file: 'src/pages/api/inbox.ts', path: '/api/inbox', kind: 'open', probe: { fields: { kind: 'nope' } }, answer: { status: 400 } },
  { file: 'src/pages/api/corrections.ts', path: '/api/corrections', kind: 'open', probe: { fields: { type: 'nope', slug: 'x' } }, answer: { status: 400 } },
];

// Endpoints that take no session and are not part of the matrix: where they are tested, and why they are open.
const OTHER_ROUTES = {
  'src/pages/api/auth/[...all].ts': 'Better Auth handler; origin checks, throttling and cookie attributes are tested below and in test-auth.mjs',
  'src/pages/api/ads/impressions.ts': 'signed-token beacon; forged tokens are tested below',
  'src/pages/api/csp-report.ts': 'violation reports; tested in test-csp-report.mjs',
  'src/pages/ads/click.ts': 'signed-token redirect; forged tokens are tested below',
  'src/pages/media/[...key].ts': 'public library images',
  'src/pages/feed.json.ts': 'public feed', 'src/pages/feed.ts': 'public redirect', 'src/pages/news-sitemap.xml.ts': 'public sitemap',
  'src/pages/robots.txt.ts': 'public robots.txt', 'src/pages/rss.ts': 'public redirect', 'src/pages/rss.xml.ts': 'public feed',
  'src/pages/sitemap.xml.ts': 'public sitemap', 'src/pages/events/[slug].ics.ts': 'public calendar file',
};
// Of those, the ones that only read. Anything else here that grows a POST/PUT/PATCH/DELETE handler fails the inventory.
const READ_ONLY = new Set(Object.keys(OTHER_ROUTES).filter((file) => !/auth|impressions|csp-report/.test(file)));

// ---- Source-level checks ----

function walk(directory, found = []) {
  for (const name of readdirSync(join(root, directory)).sort()) {
    const path = `${directory}/${name}`;
    if (statSync(join(root, path)).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}
const exportedMethods = (source) => [...source.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE|ALL|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
const firstBodyRead = (source) => {
  const hit = source.search(/readForm\(|readText\(|readBytes\(|request\.formData\(|request\.text\(|request\.json\(|request\.body\b/);
  return hit === -1 ? source.length : hit;
};

test('every endpoint is classified, and mutating methods stay with the guarded routes', () => {
  const endpoints = walk('src/pages').filter((path) => path.endsWith('.ts'));
  const known = new Set([...ROUTES.map((route) => route.file), ...Object.keys(OTHER_ROUTES)]);
  assert.deepEqual(endpoints.filter((path) => !known.has(path)), [],
    'new endpoint: add it to ROUTES (with its guard and attacks) or OTHER_ROUTES (with the reason it is open) in scripts/test-authorization.mjs');
  assert.deepEqual([...known].filter((path) => !endpoints.includes(path)), [], 'a listed endpoint no longer exists');
  for (const path of READ_ONLY) assert.deepEqual(exportedMethods(read(path)).filter((method) => method !== 'GET' && method !== 'HEAD'), [], `${path} must only read`);
  for (const route of ROUTES) {
    assert.deepEqual(exportedMethods(read(route.file)).sort(), [...new Set(ROUTES.filter((other) => other.file === route.file).map((other) => other.method ?? 'POST'))].sort(), route.file);
  }
});

test('staff endpoints check the role first, name the right section, refuse cross-origin posts, and record refusals', () => {
  for (const route of ROUTES.filter((entry) => entry.kind === 'staff')) {
    const source = read(route.file);
    const guard = route.guard === 'admin-only'
      ? source.search(/locals\.staffRole !== 'admin'/)
      : route.guard === 'any-staff'
        ? source.search(/!locals\.staffRole/)
        : source.search(new RegExp(`canAccess\\(locals\\.staffRole, ADMIN\\.${route.guard}\\)`));
    assert.ok(guard !== -1, `${route.file} needs a role check for ${route.guard}`);
    // `mixed` routes let any staff member act on themselves and check the role for another user's record once the form is read.
    if (!route.mixed) assert.ok(guard < firstBodyRead(source), `${route.file} reads the body before checking the role`);
    if (route.method !== 'GET') {
      const origin = source.search(/sameOrigin\(request\)/);
      assert.ok(origin !== -1 && origin < firstBodyRead(source), `${route.file} must reject cross-origin posts before reading the body`);
    }
    if (route.audit) assert.match(source, new RegExp(`denyAdmin\\(locals, request, '${route.audit}', 'role'\\)`), `${route.file} should record role refusals`);
    if (route.audit && route.method !== 'GET') assert.match(source, new RegExp(`denyAdmin\\(locals, request, '${route.audit}', 'origin'\\)`), `${route.file} should record origin refusals`);
  }
});

test('member and open endpoints check the account and the request origin before reading the body', () => {
  for (const route of ROUTES.filter((entry) => entry.kind !== 'staff')) {
    const source = read(route.file);
    const origin = source.search(/sameOrigin\(request\)/);
    assert.ok(origin !== -1 && origin < firstBodyRead(source), `${route.file} must reject cross-origin posts before reading the body`);
    if (route.kind === 'member') {
      const user = source.search(/!locals\.user|!user\b/);
      assert.ok(user !== -1 && user < firstBodyRead(source), `${route.file} must require a signed-in account before reading the body`);
    }
  }
  // The two beacons have no session; each refuses another site's pages itself.
  assert.match(read('src/pages/api/ads/impressions.ts'), /origin !== new URL\(request\.url\)\.origin\) return new Response\(null, \{ status: 403 \}\)/);
  assert.match(read('src/pages/api/csp-report.ts'), /foreign/);
});

test('every admin page checks its section before touching the database or the form', () => {
  const sectionOf = { '': 'dashboard', ads: 'ads', businesses: 'businesses', corrections: 'corrections', events: 'events', links: 'links', facebook: 'facebook', media: 'media', news: 'news', submissions: 'submissions', talk: 'talk', users: 'users' };
  const pages = walk('src/pages/admin').filter((path) => path.endsWith('.astro'));
  assert.ok(pages.length >= 25);
  for (const path of pages) {
    const directory = path.split('/').slice(3, -1)[0] ?? '';
    assert.ok(Object.hasOwn(sectionOf, directory), `${path}: new admin area; add it to this test and ADMIN`);
    const source = read(path).split('---')[1];
    const guard = source.search(new RegExp(`requireSection\\(Astro, ADMIN\\.${sectionOf[directory]}\\)`));
    assert.ok(guard !== -1, `${path} must call requireSection(Astro, ADMIN.${sectionOf[directory]})`);
    assert.match(source.slice(guard), /^[^\n]*\n\s*if \(denied\)/, `${path} must return the refusal at once`);
    const beforeGuard = source.slice(0, guard);
    assert.ok(!/await |env\.DB|readForm\(|Astro\.request/.test(beforeGuard.replace(/^import .*$/gm, '')), `${path} does work before its role check`);
    if (/method === 'POST'/.test(source)) {
      const post = source.search(/method === 'POST'\) \{/);
      const origin = source.slice(post).search(/sameOrigin\(Astro\.request\)/);
      const body = source.slice(post).search(/readForm\(/);
      assert.ok(origin !== -1 && origin < body, `${path} must reject cross-origin posts before reading the form`);
    }
  }
});

test('business pages resolve the business through requireBusiness and never trust the URL for the ad', () => {
  for (const path of ['src/pages/business/[id]/index.astro', 'src/pages/business/[id]/ads/[adId].astro']) {
    const source = read(path).split('---')[1];
    const guard = source.search(/const access = await requireBusiness\(Astro, Astro\.params\.id \?\? ''\);\s*if \(access instanceof Response\) return access;/);
    assert.ok(guard !== -1, path);
    assert.ok(!/env\.DB|getAd\(|listAds\(|getStats\(/.test(source.slice(0, guard)), `${path} queries before the membership check`);
  }
  assert.match(read('src/pages/business/[id]/ads/[adId].astro'), /found\.record\.business_id !== business\.id/);
  assert.match(read('src/pages/business/index.astro'), /if \(!user\) return Astro\.redirect/);
});

test('auth configuration does not weaken cookies, origin checks, or CSRF protection', () => {
  const source = read('src/lib/auth.ts');
  for (const weakening of [/httpOnly:\s*false/, /secure:\s*false/, /useSecureCookies:\s*false/, /sameSite:\s*['"]none['"]/i, /disableCSRFCheck/, /disableOriginCheck/,
    /crossSubDomainCookies/, /defaultCookieAttributes/, /cookies:\s*\{/, /trustedOrigins:\s*\[\s*['"]\*/]) {
    assert.doesNotMatch(source, weakening);
  }
  assert.match(read('wrangler.jsonc'), /"SITE_URL":\s*"https:\/\//, 'production SITE_URL must be https so Better Auth marks cookies Secure');
});

// ---- Staff roles ----

test('the admin sections allow exactly the roles written down here, and every staff role is accounted for', () => {
  assert.deepEqual(Object.keys(ADMIN).sort(), Object.keys(SECTION_ROLES).sort(), 'a section was added or removed: update SECTION_ROLES');
  const roles = Object.keys(ROLE_LABELS);
  assert.deepEqual([...roles].sort(), ['admin', 'editor', 'moderator'], 'a staff role was added: extend the matrix');
  for (const [key, section] of Object.entries(ADMIN)) {
    assert.deepEqual([...section.roles].sort(), [...SECTION_ROLES[key]].sort(), `ADMIN.${key}`);
    for (const role of [...roles, null]) assert.equal(canAccess(role, section), SECTION_ROLES[key].includes(role), `${role} on ${key}`);
  }
  for (const role of roles) assert.deepEqual(sectionsFor(role).sort(), Object.keys(SECTION_ROLES).filter((key) => SECTION_ROLES[key].includes(role)).sort(), role);
  assert.deepEqual(roles.filter((role) => canAccess(role, ADMIN.users)), ['admin']);
  assert.equal(canAccess('admin', ADMIN.dashboard) && canAccess('editor', ADMIN.dashboard) && canAccess('moderator', ADMIN.dashboard), true);
});

test('requireSection redirects signed-out visitors, refuses readers and the wrong role, and admits the right ones', () => {
  const ask = (user, staffRole, section) => requireSection({ locals: { user, staffRole }, url: new URL('/admin/users', origin), redirect }, section);
  const signedOut = ask(null, null, ADMIN.users);
  assert.equal(signedOut.status, 302);
  assert.equal(location(signedOut), '/sign-in?next=%2Fadmin%2Fusers');
  assert.equal(ask({ id: 'u' }, null, ADMIN.dashboard).status, 403);
  // A role in the database with no signed-in user (the middleware's output for a suspended account) is signed out.
  assert.equal(ask(null, 'admin', ADMIN.dashboard).status, 302);
  for (const [key, section] of Object.entries(ADMIN)) {
    for (const role of Object.keys(ROLE_LABELS)) {
      const result = ask({ id: 'u' }, role, section);
      if (SECTION_ROLES[key].includes(role)) assert.equal(result, null, `${role} on ${key}`);
      else assert.equal(result.status, 403, `${role} on ${key}`);
    }
  }
});

// ---- Every endpoint, every kind of visitor ----

const WHO = Object.entries(ACTORS);
const permitted = (route, actor) => route.kind === 'staff' ? route.roles.includes(actor.effective) : route.kind === 'member' ? actor.signedIn : true;

test('endpoint access matrix: signed-out, suspended, reader, business owner, and each staff role', async (t) => {
  for (const route of ROUTES) {
    await t.test(`${route.method ?? 'POST'} ${route.path}`, async () => {
      for (const [name, actor] of WHO) {
        if (permitted(route, actor)) {
          // Positive control: the guard lets this actor through to the route's own validation.
          const response = await call(actor, route, route.probe);
          assert.equal(response.status, route.answer.status, `${name} should reach ${route.path}`);
          if (route.answer.location) assert.match(location(response), route.answer.location, name);
          continue;
        }
        const reference = snapshot();
        for (const attack of route.attacks) {
          const response = await call(actor, route, attack);
          if (!actor.signedIn) {
            // Not recognised as anyone (never signed in, or suspended): sent to sign in, or refused outright.
            assert.ok(toSignIn(response) || response.status === 403, `${name} on ${route.path}: ${response.status} ${location(response)}`);
          } else if (route.kind === 'staff') {
            assert.equal(response.status, 403, `${name} on ${route.path}`);
            assert.doesNotMatch(await response.clone().text(), /Unpublished draft text|<p>/, name);
          } else {
            assert.ok(toSignIn(response) || response.status === 403, `${name} on ${route.path}`);
          }
        }
        assert.equal(snapshot(), reference, `${name} changed data through ${route.path}`);
      }
    });
  }
  assert.deepEqual(deletedObjects, [], 'a refused request deleted a stored file');
});

test('cross-origin and origin-less posts are refused for every form endpoint, even from a permitted account', async () => {
  for (const route of ROUTES.filter((entry) => (entry.method ?? 'POST') === 'POST')) {
    const actor = WHO.map(([, entry]) => entry).find((entry) => permitted(route, entry) && entry.signedIn) ?? ACTORS.signedOut;
    const request = route.attacks?.[0] ?? route.probe;
    const reference = snapshot();
    for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: 'null' }, { origin: null }]) {
      const response = await call(actor, route, request, headers);
      assert.equal(response.status, 403, `${route.path} with origin ${headers.origin}`);
    }
    assert.equal(snapshot(), reference, route.path);
  }
});

test('refused staff requests are audited for signed-in accounts only, once per account and action', () => {
  const rows = database.prepare("SELECT actor_id, action FROM admin_audit_log WHERE outcome = 'denied'").all();
  const logged = new Set(rows.map((row) => `${row.actor_id}:${row.action}`));
  for (const route of ROUTES.filter((entry) => entry.kind === 'staff' && entry.audit)) {
    for (const [, actor] of WHO) {
      const key = `${actor.id}:${route.audit}`;
      if (actor.signedIn && !permitted(route, actor)) assert.ok(logged.has(key), `${key} should be recorded`);
      if (!actor.signedIn) assert.ok(!logged.has(key), `${key} should not be recorded: the account is treated as signed out`);
    }
  }
  assert.equal(rows.filter((row) => row.actor_id === null).length, 0);
  assert.equal(rows.length, logged.size, 'a refusal was logged more than once');
});

test('author bios: staff set their own, only the Users section sets anyone else’s, everyone else is refused', async (t) => {
  const bio = ROUTES.find((route) => route.path === '/api/bio');
  const stored = (id) => database.prepare('SELECT bio FROM staff_bios WHERE user_id = ?').get(id)?.bio ?? null;
  const audit = (action) => database.prepare('SELECT actor_id, target_id, outcome, detail FROM admin_audit_log WHERE action = ? ORDER BY created_at').all(action);
  // Refusals are recorded once per account and action every ten minutes, and the matrix has already used that allowance.
  database.prepare("DELETE FROM admin_audit_log WHERE outcome = 'denied' AND action = 'user-admin'").run();
  database.prepare("DELETE FROM admin_audit_log WHERE action = 'update-bio'").run();

  await t.test('every staff role sets its own bio, with or without naming itself, and the edit is not audited', async () => {
    for (const [name, id] of [['moderator', 'moderator'], ['editor', 'editor'], ['admin', 'admin']]) {
      const response = await call(ACTORS[name], bio, { fields: { bio: `Own bio for ${name}.` } });
      assert.equal(response.status, 303);
      assert.equal(location(response), '/account?bio=saved');
      assert.equal(stored(id), `Own bio for ${name}.`);
    }
    const named = await call(ACTORS.moderator, bio, { fields: { userId: 'moderator', bio: 'Named myself.' } });
    assert.equal(location(named), '/account?bio=saved');
    assert.equal(stored('moderator'), 'Named myself.');
    assert.deepEqual(audit('update-bio'), []);
  });

  await t.test('an administrator sets another staff member’s bio and the change is audited without the text', async () => {
    const response = await call(ACTORS.admin, bio, { fields: { userId: 'editor', bio: 'Edited by an administrator.' } });
    assert.equal(response.status, 303);
    assert.equal(location(response), '/admin/users/editor?bio=saved');
    assert.equal(stored('editor'), 'Edited by an administrator.');
    const [entry, ...rest] = audit('update-bio');
    assert.deepEqual(rest, []);
    assert.equal(entry.actor_id, 'admin');
    assert.equal(entry.outcome, 'success');
    assert.ok(!entry.detail.includes('Edited by an administrator'));
  });

  await t.test('moderators and editors cannot set someone else’s bio, and the attempt is recorded', async () => {
    const before = snapshot();
    for (const [name, target] of [['moderator', 'admin'], ['moderator', 'editor'], ['editor', 'admin'], ['editor', 'moderator']]) {
      const response = await call(ACTORS[name], bio, { fields: { userId: target, bio: 'Hijacked.' } });
      assert.equal(response.status, 403, `${name} -> ${target}`);
    }
    assert.equal((await call(ACTORS.editor, bio, { fields: { userId: 'admin', bio: '' } })).status, 403, 'clearing is an edit too');
    assert.equal(snapshot(), before);
    assert.equal(stored('admin'), 'Own bio for admin.');
    assert.deepEqual(audit('user-admin').filter((row) => row.outcome === 'denied').map((row) => row.actor_id).sort(), ['editor', 'moderator']);
  });

  await t.test('readers, business owners, signed-out and suspended accounts are refused outright, for their own bio or anyone’s', async () => {
    const before = snapshot();
    const deniedBefore = audit('user-admin').length;
    for (const name of ['reader', 'businessOwner', 'signedOut', 'suspendedAdmin']) {
      for (const fields of [{ bio: 'Mine.' }, { userId: ACTORS[name].id ?? 'reader', bio: 'Mine.' }, { userId: 'admin', bio: 'Hijacked.' }]) {
        const response = await call(ACTORS[name], bio, { fields });
        assert.equal(response.status, 403, `${name} ${JSON.stringify(fields)}`);
      }
    }
    assert.equal(snapshot(), before);
    assert.equal(audit('user-admin').length, deniedBefore, 'these refusals are not staff-role denials');
  });

  await t.test('cross-origin posts are refused, even from an administrator', async () => {
    const before = snapshot();
    for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: null }]) {
      assert.equal((await call(ACTORS.admin, bio, { fields: { userId: 'editor', bio: 'Forged.' } }, headers)).status, 403);
      assert.equal((await call(ACTORS.moderator, bio, { fields: { bio: 'Forged.' } }, headers)).status, 403);
    }
    assert.equal(snapshot(), before);
  });

  await t.test('only staff have a bio, and unknown accounts are not found', async () => {
    assert.equal((await call(ACTORS.admin, bio, { fields: { userId: 'victim', bio: 'x' } })).status, 400);
    assert.equal((await call(ACTORS.admin, bio, { fields: { userId: 'nobody', bio: 'x' } })).status, 404);
    assert.equal((await call(ACTORS.admin, bio, { fields: { userId: '../etc', bio: 'x' } })).status, 400);
    assert.equal(stored('victim'), null);
  });

  await t.test('a role removed under a live session takes the bio endpoint away on the next request', async () => {
    addUser('bioist', 'editor');
    const cookie = await signIn('bioist');
    assert.equal((await call({ cookie }, bio, { fields: { bio: 'Hello.' } })).status, 303);
    database.prepare("DELETE FROM staff_roles WHERE user_id = 'bioist'").run();
    assert.equal((await call({ cookie }, bio, { fields: { bio: 'Changed my mind.' } })).status, 403);
    assert.equal(stored('bioist'), 'Hello.');
  });
});

// ---- Suspended accounts, and roles that change under a live session ----

test('community link pages enforce roles, suspension and origin before saving; permitted staff can create and edit', async () => {
  const { getLink } = await import(load('src/lib/links.ts'));
  const render = async (file, actor, method = 'GET', fields = {}, id = '', source = origin) => {
    const path = file.endsWith('new.astro') ? '/admin/links/new' : id ? `/admin/links/${id}` : '/admin/links';
    const request = new Request(new URL(path, origin), {
      method, headers: { cookie: actor.cookie, ...(source ? { origin: source } : {}) },
      ...(method === 'POST' ? { body: new URLSearchParams(fields) } : {}),
    });
    const context = { request, url: new URL(path, origin), params: { id }, locals: {}, redirect };
    const page = await import(load(file, true));
    return onRequest(context, () => page.render(context));
  };
  const fields = { name: 'Community fixture', url: 'https://example.test/official', county: 'erie', community: 'Sandusky',
    category: 'library', description: '', checked_on: '2026-01-01', status: 'published' };
  for (const file of ['src/pages/admin/links/index.astro', 'src/pages/admin/links/new.astro', 'src/pages/admin/links/[id].astro']) {
    for (const actor of Object.values(ACTORS)) {
      if (['admin', 'editor'].includes(actor.effective)) continue;
      for (const method of file.endsWith('index.astro') ? ['GET'] : ['GET', 'POST']) {
        const before = snapshot();
        const response = await render(file, actor, method, fields, 'link-fixture-1');
        assert.equal(response.status, actor.signedIn ? 403 : 302);
        assert.deepEqual(snapshot(), before);
      }
    }
  }
  for (const actor of [ACTORS.editor, ACTORS.admin]) {
    for (const file of ['src/pages/admin/links/new.astro', 'src/pages/admin/links/[id].astro']) {
      for (const source of ['https://other.example', null]) {
        const before = snapshot();
        assert.equal((await render(file, actor, 'POST', fields, 'link-fixture-1', source)).status, 403);
        assert.deepEqual(snapshot(), before);
      }
    }
    const response = await render('src/pages/admin/links/new.astro', actor, 'POST', fields);
    assert.equal(response.status, 303);
    const id = location(response).split('/').at(-1).split('?')[0];
    assert.equal((await getLink(id)).status, 'published');
    assert.equal((await render('src/pages/admin/links/[id].astro', actor, 'POST', { ...fields, status: 'draft', name: 'Edited fixture' }, id)).status, 303);
    assert.equal((await getLink(id)).name, 'Edited fixture');
    assert.equal((await getLink(id)).status, 'draft');
    assert.equal((await render('src/pages/admin/links/index.astro', actor)).status, 200);
  }
});

const seen = async (cookie) => {
  const context = { url: new URL('/', origin), request: new Request(origin, { headers: { cookie } }), locals: {}, redirect };
  await onRequest(context, () => new Response('ok'));
  const { cspNonce, ...locals } = context.locals;
  return locals;
};
const signedOutLocals = { user: null, session: null, staffRole: null };
const usersApi = () => ROUTES.find((route) => route.path === '/api/admin/users');
const startThread = ROUTES.find((route) => route.path === '/api/talk/threads');

test('suspending an account signs it out at once and blocks sign-in until the suspension ends', async (t) => {
  addUser('target');
  const cookie = await signIn('target');
  const adminSession = database.prepare("SELECT id FROM session WHERE userId = 'admin'").get().id;
  const admin = (fields) => call(ACTORS.admin, usersApi(), { fields });

  await t.test('before the suspension the account is recognised', async () => {
    assert.equal((await seen(cookie)).user.id, 'target');
  });

  await t.test('the admin endpoint suspends it and ends its sessions, so the old cookie stops working', async () => {
    await recordReauth(adminSession);
    const response = await admin({ action: 'suspend', userId: 'target', reason: 'Fixture', duration: '7' });
    assert.match(location(response), /notice=suspended/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM session WHERE userId = 'target'").get().n, 0);
    assert.deepEqual(await seen(cookie), signedOutLocals);
  });

  await t.test('it cannot sign in with the right password while suspended', async () => {
    const response = await authPost('sign-in/email', { email: 'target@example.test', password });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ACCOUNT_SUSPENDED');
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM session WHERE userId = 'target'").get().n, 0);
  });

  await t.test('lifting the suspension restores sign-in', async () => {
    await recordReauth(adminSession);
    assert.match(location(await admin({ action: 'unsuspend', userId: 'target' })), /notice=unsuspended/);
    assert.equal((await seen(await signIn('target'))).user.id, 'target');
  });

  await t.test('staff accounts cannot be suspended, and a suspended account cannot be given a staff role', async () => {
    await recordReauth(adminSession);
    assert.match(location(await admin({ action: 'suspend', userId: 'editor', reason: 'Fixture', duration: '7' })), /error=staff/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user_suspensions WHERE user_id = 'editor'").get().n, 0);
    await admin({ action: 'suspend', userId: 'victim', reason: 'Fixture', duration: '7' });
    assert.match(location(await admin({ action: 'set-role', userId: 'victim', role: 'editor' })), /error=suspended-role/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM staff_roles WHERE user_id = 'victim'").get().n, 0);
    database.prepare("DELETE FROM user_suspensions WHERE user_id = 'victim'").run();
  });
});

test('a suspension that lands after a session was opened still signs that session out, and expires on time', async (t) => {
  addUser('lapsed');
  const cookie = await signIn('lapsed');
  const suspension = (expiresAt) => {
    database.prepare('DELETE FROM user_suspensions WHERE user_id = ?').run('lapsed');
    database.prepare('INSERT INTO user_suspensions (user_id, reason, created_at, expires_at) VALUES (?, ?, ?, ?)').run('lapsed', 'Fixture', Date.now(), expiresAt);
  };
  const threads = () => database.prepare("SELECT COUNT(*) AS n FROM forum_threads WHERE author_id = 'lapsed'").get().n;

  await t.test('an open-ended suspension', async () => {
    suspension(null);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM session WHERE userId = 'lapsed'").get().n, 1, 'the session itself is still stored');
    assert.deepEqual(await seen(cookie), signedOutLocals);
    const response = await call({ cookie }, startThread, startThread.attacks[0]);
    assert.ok(toSignIn(response), `${response.status} ${location(response)}`);
    assert.equal(threads(), 0);
  });

  await t.test('a timed suspension that has not run out', async () => {
    suspension(Date.now() + 60_000);
    assert.deepEqual(await seen(cookie), signedOutLocals);
    assert.ok(toSignIn(await call({ cookie }, startThread, startThread.attacks[0])));
    assert.equal(threads(), 0);
  });

  await t.test('a suspension that has run out no longer applies', async () => {
    suspension(Date.now() - 1000);
    assert.equal((await seen(cookie)).user.id, 'lapsed');
    const response = await call({ cookie }, startThread, startThread.attacks[0]);
    assert.match(location(response), /^\/talk\/[0-9a-f-]{36}$/);
    assert.equal(threads(), 1);
  });
});

test('a suspended staff account reaches no admin endpoint or page through the session it already held', async () => {
  assert.deepEqual(await seen(ACTORS.suspendedAdmin.cookie), signedOutLocals);
  const response = await call(ACTORS.suspendedAdmin, usersApi(), { fields: { action: 'bogus', userId: 'missing' } });
  assert.equal(response.status, 403);
  const dashboard = await import(load('src/pages/admin/index.astro', true));
  const context = { url: new URL('/admin', origin), request: new Request(`${origin}/admin`, { headers: { cookie: ACTORS.suspendedAdmin.cookie } }), locals: {}, redirect };
  const page = await onRequest(context, () => dashboard.render(context));
  assert.equal(page.status, 302);
  assert.match(location(page), /^\/sign-in\?next=/);
});

test('a staff role removed under a live session ends that session’s access on the next request', async () => {
  addUser('shifter', 'editor');
  const cookie = await signIn('shifter');
  const preview = ROUTES.find((route) => route.path === '/api/admin/news/preview');
  assert.equal((await call({ cookie }, preview, preview.probe)).status, 200);
  assert.equal((await seen(cookie)).staffRole, 'editor');
  database.prepare("DELETE FROM staff_roles WHERE user_id = 'shifter'").run();
  assert.equal((await call({ cookie }, preview, preview.probe)).status, 403);
  assert.equal((await seen(cookie)).staffRole, null);
  database.prepare("INSERT INTO staff_roles (user_id, role, created_at) VALUES ('shifter', 'moderator', ?)").run(Date.now());
  assert.equal((await call({ cookie }, preview, preview.probe)).status, 403, 'a moderator cannot use the story preview');
});

test('self-service account endpoints cannot grant a role or verify an address', async () => {
  const cookie = ACTORS.reader.cookie;
  const rolesBefore = database.prepare('SELECT COUNT(*) AS n FROM staff_roles').get().n;
  const response = await authPost('update-user', { name: 'Renamed Reader', role: 'admin', emailVerified: false, email: 'reader-new@example.test', id: 'admin' }, { cookie });
  assert.ok(response.status < 500);
  const row = database.prepare("SELECT name, email, emailVerified FROM user WHERE id = 'reader'").get();
  assert.equal(row.email, 'reader@example.test');
  assert.equal(row.emailVerified, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM staff_roles').get().n, rolesBefore);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE id = 'admin' AND name != 'admin'").get().n, 0);
  assert.equal((await seen(cookie)).staffRole, null);
});


// ---- Business members and other businesses' IDs ----

test('business members see only their own business and its non-draft ads; guessing other IDs gives the same 404 as nonsense', async (t) => {
  const index = await import(load('src/pages/business/[id]/index.astro', true));
  const adPage = await import(load('src/pages/business/[id]/ads/[adId].astro', true));
  const visit = async (actor, module, params) => {
    const url = new URL(`/business/${params.id}${params.adId ? `/ads/${params.adId}` : ''}`, origin);
    const context = { url, params, request: new Request(url, { headers: { cookie: actor.cookie } }), locals: {}, redirect };
    const response = await onRequest(context, () => module.render(context));
    return { status: response.status, location: location(response), text: response.status === 404 ? await response.text() : '' };
  };
  const owner = ACTORS.businessOwner;

  await t.test('the owner reaches their business and its live ad', async () => {
    assert.equal((await visit(owner, index, { id: fx.businessA })).status, 200);
    assert.equal((await visit(owner, adPage, { id: fx.businessA, adId: fx.adA })).status, 200);
  });

  await t.test('the owner cannot open another business, or its ads through their own URL', async () => {
    const other = await visit(owner, index, { id: fx.businessB });
    const nonsense = await visit(owner, index, { id: 'no-such-business' });
    assert.deepEqual(other, nonsense, 'existing and missing businesses must be indistinguishable');
    assert.equal(other.status, 404);
    for (const params of [
      { id: fx.businessB, adId: fx.adB }, { id: fx.businessB, adId: fx.adA }, { id: fx.businessA, adId: fx.adB },
      { id: fx.businessA, adId: fx.adBDraft }, { id: fx.businessA, adId: 'no-such-ad' },
    ]) assert.equal((await visit(owner, adPage, params)).status, 404, JSON.stringify(params));
    assert.deepEqual(await visit(owner, adPage, { id: fx.businessA, adId: fx.adB }), await visit(owner, adPage, { id: fx.businessA, adId: 'no-such-ad' }));
  });

  await t.test('drafts stay staff-only, even in the member’s own business', async () => {
    assert.equal((await visit(owner, adPage, { id: fx.businessA, adId: fx.adADraft })).status, 404);
    assert.equal((await visit(ACTORS.admin, adPage, { id: fx.businessA, adId: fx.adADraft })).status, 200);
  });

  await t.test('staff who manage ads can view any business as a client would; other staff and readers cannot', async () => {
    assert.equal((await visit(ACTORS.admin, index, { id: fx.businessB })).status, 200);
    assert.equal((await visit(ACTORS.admin, adPage, { id: fx.businessB, adId: fx.adB })).status, 200);
    for (const actor of [ACTORS.editor, ACTORS.moderator, ACTORS.reader]) {
      assert.equal((await visit(actor, index, { id: fx.businessA })).status, 404);
      assert.equal((await visit(actor, adPage, { id: fx.businessA, adId: fx.adA })).status, 404);
    }
  });

  await t.test('signed-out and suspended visitors are sent to sign in, never shown a business', async () => {
    for (const actor of [ACTORS.signedOut, ACTORS.suspendedAdmin]) {
      const result = await visit(actor, index, { id: fx.businessA });
      assert.equal(result.status, 302);
      assert.match(result.location, /^\/sign-in\?next=/);
    }
  });

  await t.test('a member of one business gets nowhere with the admin endpoints that take business and ad IDs', async () => {
    const reference = snapshot();
    const ads = ROUTES.find((r) => r.path === '/api/admin/ads');
    const businesses = ROUTES.find((r) => r.path === '/api/admin/businesses');
    for (const [route, fields] of [
      [ads, { action: 'delete', adId: fx.adB, confirm: `Ad ${fx.adB}` }], [ads, { action: 'activate', adId: fx.adBDraft }],
      [ads, { action: 'delete', adId: fx.adA, confirm: `Ad ${fx.adA}` }],
      [businesses, { action: 'add-member', businessId: fx.businessB, userId: 'owner' }],
      [businesses, { action: 'remove-member', businessId: fx.businessA, userId: 'owner' }],
      [businesses, { action: 'update-member', businessId: fx.businessA, userId: 'owner', role: 'member' }],
      [businesses, { action: 'archive', businessId: fx.businessB }],
    ]) assert.equal((await call(owner, route, { fields })).status, 403, JSON.stringify(fields));
    assert.equal(snapshot(), reference);
  });

  await t.test('ad impression and click tokens must be signed by the site; forged ones count for nothing', async () => {
    const impressions = await import(load('src/pages/api/ads/impressions.ts'));
    const click = await import(load('src/pages/ads/click.ts'));
    const counts = () => database.prepare('SELECT id, impressions, clicks FROM ads ORDER BY id').all().map((row) => ({ ...row }));
    const reference = counts();
    const stamped = Date.now();
    const beacon = (tokens) => new Request(`${origin}/api/ads/impressions`, { method: 'POST', headers: { origin, 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify(tokens) });
    const forged = [`${fx.adB}~sidebar~${stamped}~aaaaaaaaaaaaaaaaaaaa~AAAAAAAAAAAAAAAAAAAAAA`, `${fx.adB}~sidebar~${stamped}~bbbbbbbbbbbbbbbbbbbb~`, 'x~y~z'];
    assert.equal((await impressions.POST({ request: beacon(forged) })).status, 204);
    const tampered = (await signEvent(fx.adA, 'sidebar')).replace(fx.adA, fx.adB);
    assert.equal((await impressions.POST({ request: beacon([tampered]) })).status, 204);
    for (const token of [...forged, tampered]) {
      const url = new URL(`/ads/click?t=${encodeURIComponent(token)}&v=1`, origin);
      const response = await click.GET({ request: new Request(url, { headers: { 'user-agent': 'Mozilla/5.0' } }), url });
      assert.equal(response.status, 302);
      assert.equal(new URL(location(response), origin).pathname, '/');
    }
    assert.deepEqual(counts(), reference);
    // The real thing counts once.
    const genuine = await signEvent(fx.adA, 'sidebar');
    await impressions.POST({ request: beacon([genuine, genuine]) });
    await impressions.POST({ request: beacon([genuine]) });
    assert.equal(counts().find((row) => row.id === fx.adA).impressions, 1);
    const clickUrl = new URL(`/ads/click?t=${encodeURIComponent(genuine)}&v=1`, origin);
    const real = await click.GET({ request: new Request(clickUrl, { headers: { 'user-agent': 'Mozilla/5.0' } }), url: clickUrl });
    assert.equal(location(real), 'https://example.com/offer');
    assert.equal(counts().find((row) => row.id === fx.adA).clicks, 1);
    assert.equal(counts().find((row) => row.id === fx.adB).impressions, 0);
  });
});

// ---- Session cookies ----

function parseCookie(header) {
  const [pair, ...attributes] = header.split(/;\s*/);
  const eq = pair.indexOf('=');
  const parsed = { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes: new Map() };
  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split('=');
    parsed.attributes.set(key.toLowerCase(), rest.join('=') || true);
  }
  return parsed;
}

test('session cookies are HttpOnly, SameSite=Lax, path-wide, host-only, and Secure on the production origin', async (t) => {
  const production = 'https://firelandscurrent.com';
  const secureAuth = (() => {
    const env = globalThis.__authorizationEnv;
    const previous = env.SITE_URL;
    env.SITE_URL = production;
    try { return createAuth(); } finally { env.SITE_URL = previous; }
  })();
  const email = { email: 'reader@example.test', password };

  await t.test('sign-in on the production origin', async () => {
    const response = await authPost('sign-in/email', email, { instance: secureAuth, site: production });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie().map(parseCookie);
    const session = cookies.find((cookie) => /session_token$/.test(cookie.name));
    assert.ok(session, 'a session cookie is issued');
    assert.equal(session.name, '__Secure-better-auth.session_token');
    for (const cookie of cookies) {
      assert.ok(cookie.attributes.has('httponly'), `${cookie.name} HttpOnly`);
      assert.ok(cookie.attributes.has('secure'), `${cookie.name} Secure`);
      assert.equal(String(cookie.attributes.get('samesite')).toLowerCase(), 'lax', `${cookie.name} SameSite`);
      assert.equal(cookie.attributes.get('path'), '/', `${cookie.name} Path`);
      assert.ok(!cookie.attributes.has('domain'), `${cookie.name} must be host-only`);
    }
    const maxAge = Number(session.attributes.get('max-age'));
    assert.ok(maxAge > 0 && maxAge <= 60 * 60 * 24 * 7, `session lifetime ${maxAge}s`);
    t.diagnostic(`cookies: ${cookies.map((cookie) => cookie.name).join(', ')}`);
  });

  await t.test('sign-out revokes the session on the server and clears the cookie with the same attributes', async () => {
    const signedIn = await authPost('sign-in/email', email, { instance: secureAuth, site: production });
    const cookie = cookieHeader(signedIn);
    const out = await authPost('sign-out', {}, { cookie, instance: secureAuth, site: production });
    assert.equal(out.status, 200);
    const cleared = out.headers.getSetCookie().map(parseCookie).find((entry) => /session_token$/.test(entry.name));
    assert.equal(cleared.value, '');
    assert.equal(cleared.attributes.get('max-age'), '0');
    assert.ok(cleared.attributes.has('httponly') && cleared.attributes.has('secure'));
    assert.equal(cleared.attributes.get('path'), '/');
    assert.equal(await secureAuth.api.getSession({ headers: new Headers({ cookie }) }), null, 'the old cookie must not authenticate');
  });

  await t.test('development over plain HTTP keeps HttpOnly and SameSite=Lax', async () => {
    const response = await authPost('sign-in/email', email);
    const session = response.headers.getSetCookie().map(parseCookie).find((entry) => /session_token$/.test(entry.name));
    assert.equal(session.name, 'better-auth.session_token');
    assert.ok(session.attributes.has('httponly'));
    assert.equal(String(session.attributes.get('samesite')).toLowerCase(), 'lax');
    assert.equal(session.attributes.get('path'), '/');
  });

  await t.test('a sign-in request from another origin is refused and sets no cookie', async () => {
    const response = await secureAuth.handler(new Request(`${production}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid', 'cf-connecting-ip': freshIp() }, body: JSON.stringify(email),
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(response.headers.getSetCookie(), []);
  });

  await t.test('the catch-all route passes requests to Better Auth unchanged', async () => {
    const response = await handleAuthRequest((request) => auth.handler(request), new Request(`${origin}/api/auth/get-session`, { headers: { origin } }));
    assert.equal(response.status, 200);
    assert.equal(await response.json(), null);
  });
});
