import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword } from 'better-auth/crypto';

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
// Each statement waits a turn of the event loop, like a D1 round trip, so concurrent requests interleave
// between their queries the way Worker isolates sharing one database do.
const turn = () => new Promise((resolve) => setImmediate(resolve));
const db = {
  exec: (sql) => database.exec(sql),
  prepare(sql) {
    let values = [];
    const statement = database.prepare(sql);
    const query = {
      bind(...args) { values = args; return query; },
      async all() { await turn(); return { results: statement.all(...values), meta: { changes: 0 } }; },
      async first() { await turn(); return statement.get(...values) ?? null; },
      async run() { await turn(); return { meta: statement.run(...values) }; },
    };
    return query;
  },
  async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
};
const origin = 'http://localhost:4321';
const mail = [];
globalThis.__authTestEnv = { DB: db, SITE_URL: origin,
  BETTER_AUTH_SECRET: 'auth-regression-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fixture-secret' };
globalThis.__authTestMail = mail;
const envModule = 'data:text/javascript,export const env = globalThis.__authTestEnv;';
function sourceModule(path, replacements = {}, page = false) {
  let source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  if (page) {
    const frontmatter = source.split('---')[1];
    const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
    // Execute the actual page guards and queries without rendering Astro markup.
    source = `${imports.join('\n')}\nexport async function render(Astro) {\n${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn new Response('Authorized');\n}`;
  }
  source = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const rateLimitModule = sourceModule('src/lib/auth-rate-limit.ts');
const passwordPolicyModule = sourceModule('src/lib/password-policy.ts');
const reauthModule = sourceModule('src/lib/reauth.ts');
const authModule = sourceModule('src/lib/auth.ts', {
  './mail': 'data:text/javascript,export const sendPasswordResetMail = async (user, url) => globalThis.__authTestMail.push({ user, url }); export const sendVerificationMail = async () => {};',
  './auth-rate-limit': rateLimitModule,
  './password-policy': passwordPolicyModule,
  './reauth': reauthModule,
});
const { pruneAuthRateLimits, RATE_LIMIT_RETENTION_MS } = await import(rateLimitModule);
const { createAuth } = await import(authModule);
const { onRequest } = await import(sourceModule('src/middleware.ts', {
  'astro:middleware': 'data:text/javascript,export const defineMiddleware = handler => handler;',
  './lib/auth': authModule, './lib/staff': sourceModule('src/lib/staff.ts'),
  './lib/response-headers': sourceModule('src/lib/response-headers.ts'),
}));
const portalModule = 'data:text/javascript,export const portalBusinesses = async () => [];';
const pages = {
  '/account': await import(sourceModule('src/pages/account.astro', {
    '../lib/auth': authModule, '../lib/business-portal': portalModule,
    '../lib/auth-errors': sourceModule('src/lib/auth-errors.ts'),
  }, true)),
  '/business': await import(sourceModule('src/pages/business/index.astro', { '../../lib/business-portal': portalModule }, true)),
  '/admin': await import(sourceModule('src/pages/admin/index.astro', {
    '../../lib/admin': sourceModule('src/lib/admin.ts'),
    '../../lib/events': 'data:text/javascript,export const today = () => "2026-10-10";',
  }, true)),
};
const auth = createAuth();
// Auth requests are throttled per client IP, so each comes from a fresh address unless a test names one.
let addresses = 0;
function freshIp() {
  assert.ok(++addresses < 255);
  return `192.0.2.${addresses}`;
}
function post(path, body, cookie = '', captcha = false, headers = { 'cf-connecting-ip': freshIp() }, instance = auth) {
  return instance.handler(new Request(`${origin}/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, ...headers,
      ...(captcha ? { 'x-captcha-response': 'fixture-token' } : {}) }, body: JSON.stringify(body),
  }));
}
async function signIn(email, password) {
  const response = await post('sign-in/email', { email, password });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
}
async function page(path, cookie) {
  const url = new URL(path, origin);
  const context = { url, request: new Request(url, { headers: { cookie } }), locals: {},
    redirect: (location) => new Response(null, { status: 302, headers: { Location: location } }) };
  const response = await onRequest(context, () => pages[path].render(context));
  return { response, locals: context.locals };
}
async function resetToken() {
  const response = await post('request-password-reset', { email: 'staff@example.test', redirectTo: '/reset-password' }, '', true);
  assert.equal(response.status, 200);
  const token = new URL(mail.at(-1).url).pathname.split('/').at(-1);
  const row = database.prepare('SELECT createdAt, expiresAt FROM verification WHERE identifier = ?').get(`reset-password:${token}`);
  assert.ok(Math.abs(new Date(row.expiresAt) - new Date(row.createdAt) - 3600000) < 2000);
  return token;
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  // The password blocklist range lookup: nothing in these fixtures is breached.
  if (String(url).startsWith('https://api.pwnedpasswords.com/range/')) return new Response('');
  assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  return Response.json({ success: true });
};
test.after(() => {
  globalThis.fetch = originalFetch;
  database.close();
  delete globalThis.__authTestEnv;
  delete globalThis.__authTestMail;
});

test('password-reset recovery revokes sessions at the shared page boundary', async (t) => {
  const oldPassword = 'original-fixture-password';
  const newPassword = 'replacement-fixture-password';
  const hash = await hashPassword(oldPassword);
  const now = new Date().toISOString();
  for (const id of ['staff', 'other']) {
    database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, id, `${id}@example.test`, now, now);
    database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
      .run(id, id, id, hash, now, now);
  }
  database.prepare("INSERT INTO staff_roles (user_id, role, created_at) VALUES ('staff', 'admin', ?)").run(Date.now());
  const cookies = [await signIn('staff@example.test', oldPassword), await signIn('staff@example.test', oldPassword)];
  const otherCookie = await signIn('other@example.test', oldPassword);
  let token;

  await t.test('requesting a one-hour link preserves both authenticated sessions', async () => {
    token = await resetToken();
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM session WHERE userId = 'staff'").get().count, 2);
    for (const cookie of cookies) for (const path of Object.keys(pages)) {
      assert.equal((await page(path, cookie)).response.status, 200);
    }
  });

  await t.test('invalid and expired tokens neither change the password nor revoke sessions', async () => {
    assert.equal((await post('reset-password', { token: 'invalid-fixture-token', newPassword })).status, 400);
    database.prepare('UPDATE verification SET expiresAt = ? WHERE identifier = ?')
      .run(new Date(Date.now() - 1000).toISOString(), `reset-password:${token}`);
    assert.equal((await post('reset-password', { token, newPassword })).status, 400);
    assert.equal(database.prepare("SELECT password FROM account WHERE userId = 'staff'").get().password, hash);
    for (const cookie of cookies) assert.equal((await page('/account', cookie)).response.status, 200);
    token = await resetToken();
  });

  await t.test('successful reset denies old cookies on account, business, and admin pages', async () => {
    assert.equal((await post('reset-password', { token, newPassword }, cookies[0])).status, 200);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM session WHERE userId = 'staff'").get().count, 0);
    // A new auth instance represents the next request arriving in another Worker.
    for (const cookie of cookies) {
      assert.equal(await createAuth().api.getSession({ headers: new Headers({ cookie }) }), null);
      for (const path of Object.keys(pages)) {
        const result = await page(path, cookie);
        assert.equal(result.response.status, 302);
        assert.match(result.response.headers.get('Location'), /^\/sign-in\?next=/);
        assert.deepEqual(result.locals, { user: null, session: null, staffRole: null });
      }
    }
    assert.equal((await page('/account', otherCookie)).response.status, 200);
  });

  await t.test('used links fail, the old password fails, and a fresh sign-in works', async () => {
    const freshCookie = await signIn('staff@example.test', newPassword);
    assert.equal((await post('reset-password', { token, newPassword: 'another-fixture-password' })).status, 400);
    assert.equal((await post('sign-in/email', { email: 'staff@example.test', password: oldPassword })).status, 401);
    for (const path of Object.keys(pages)) assert.equal((await page(path, freshCookie)).response.status, 200);
    assert.equal((await page('/account', otherCookie)).response.status, 200);
  });
});

test('authentication throttling is shared, atomic, and keyed by client IP and path', async (t) => {
  const email = 'throttled@example.test';
  const password = 'throttle-fixture-password';
  const now = new Date().toISOString();
  database.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('throttled', 'throttled', ?, 1, ?, ?)")
    .run(email, now, now);
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('throttled', 'throttled', 'credential', 'throttled', ?, ?, ?)")
    .run(await hashPassword(password), now, now);
  const from = (ip, extra = {}) => ({ 'cf-connecting-ip': ip, ...extra });
  const wrong = { email, password: 'wrong-fixture-password' };
  const counter = (key) => database.prepare('SELECT count FROM auth_rate_limits WHERE key = ?').get(key)?.count;
  const attacker = '203.0.113.10';

  await t.test('concurrent sign-ins across separate auth instances allow exactly the limit', async () => {
    // Separate instances stand in for Worker isolates; only the shared database connects them.
    const isolates = Array.from({ length: 4 }, () => createAuth());
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      post('sign-in/email', wrong, '', false, from(attacker), isolates[index % isolates.length])));
    const statuses = attempts.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 401).length, 3);
    assert.equal(statuses.filter((status) => status === 429).length, 9);
    for (const response of attempts.filter((response) => response.status === 429)) {
      const retry = Number(response.headers.get('X-Retry-After'));
      assert.ok(retry >= 1 && retry <= 10);
    }
    assert.equal(counter(`${attacker}|/sign-in/email`), 12);
    // Even the right password is refused from that address until the window ends.
    assert.equal((await post('sign-in/email', { email, password }, '', false, from(attacker), createAuth())).status, 429);
  });

  await t.test('another address can still sign in to the targeted account', async () => {
    assert.equal((await post('sign-in/email', { email, password }, '', false, from('198.51.100.20'))).status, 200);
  });

  await t.test('forwarded-for headers cannot select a fresh bucket', async () => {
    for (const forwarded of ['198.51.100.77', '198.51.100.78, 198.51.100.79']) {
      assert.equal((await post('sign-in/email', wrong, '', false, from(attacker, { 'x-forwarded-for': forwarded }))).status, 429);
    }
    const anonymous = [];
    for (const forwarded of ['198.51.100.81', '198.51.100.82', '198.51.100.83', '198.51.100.84']) {
      anonymous.push((await post('sign-in/email', wrong, '', false, { 'x-forwarded-for': forwarded })).status);
    }
    // Without Cloudflare's header every request shares one bucket, so it is still limited, not bypassed.
    assert.deepEqual(anonymous, [401, 401, 401, 429]);
  });

  await t.test('IPv6 clients are counted per /64 network', async () => {
    const statuses = [];
    for (const host of ['1', '2', '3', 'abcd']) {
      statuses.push((await post('sign-in/email', wrong, '', false, from(`2001:db8:1:2::${host}`))).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 429]);
    assert.equal((await post('sign-in/email', wrong, '', false, from('2001:db8:1:3::1'))).status, 401);
  });

  await t.test('reset, verification, and registration requests are limited per address', async () => {
    const sentBefore = mail.length;
    const resets = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      resets.push((await post('request-password-reset', { email, redirectTo: '/reset-password' }, '', true, from('198.51.100.30'))).status);
    }
    assert.deepEqual(resets, [200, 200, 200, 429]);
    assert.equal(mail.length - sentBefore, 3);

    const verifications = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      verifications.push((await post('send-verification-email', { email }, '', true, from('198.51.100.31'))).status);
    }
    assert.notEqual(verifications[2], 429);
    assert.equal(verifications[3], 429);

    const registrations = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      registrations.push((await post('sign-up/email', { name: 'New reader', email: `reader${attempt}@example.test`, password },
        '', true, from('198.51.100.32'))).status);
    }
    assert.deepEqual(registrations, [200, 200, 200, 429]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user WHERE email = 'reader3@example.test'").get().count, 0);
  });

  await t.test('an elapsed window starts a fresh count', async () => {
    database.prepare('UPDATE auth_rate_limits SET window_start = window_start - 10000 WHERE key = ?').run(`${attacker}|/sign-in/email`);
    assert.equal((await post('sign-in/email', { email, password }, '', false, from(attacker))).status, 200);
    assert.equal(counter(`${attacker}|/sign-in/email`), 1);
  });

  await t.test('pruning deletes only counters past retention', async () => {
    const at = Date.now();
    database.prepare('INSERT INTO auth_rate_limits (key, count, window_start) VALUES (?, 5, ?), (?, 5, ?)')
      .run('stale|/sign-in/email', at - RATE_LIMIT_RETENTION_MS - 1, 'recent|/sign-in/email', at - 60000);
    await pruneAuthRateLimits(db, at);
    assert.equal(counter('stale|/sign-in/email'), undefined);
    assert.equal(counter('recent|/sign-in/email'), 5);
    assert.equal(counter(`${attacker}|/sign-in/email`), 1);
  });
});
