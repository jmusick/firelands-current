import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword } from 'better-auth/crypto';

// Provider sign-in and linking refuse the cases that would hand one person's account to another: an
// address match never merges accounts, a provider identity belongs to one user, a link needs the same
// address, the OAuth state must come back with the browser that started the flow, suspended users get
// no session, and the last sign-in method can't be removed. Runs the real Better Auth handlers against
// an isolated in-memory database with a stubbed Facebook (test-oauth-tokens.mjs covers the happy paths).

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
const db = {
  exec: (sql) => database.exec(sql),
  prepare(sql) {
    let values = [];
    const statement = database.prepare(sql);
    const query = {
      bind(...args) { values = args; return query; },
      async all() { return { results: statement.all(...values), meta: { changes: 0 } }; },
      async first() { return statement.get(...values) ?? null; },
      async run() { return { meta: statement.run(...values) }; },
    };
    return query;
  },
  async batch(statements) { const out = []; for (const statement of statements) out.push(await statement.all()); return out; },
};
const origin = 'http://localhost:4321';
const secret = 'social-sign-in-regression-secret-at-least-32-characters';
globalThis.__socialTestEnv = { DB: db, SITE_URL: origin, BETTER_AUTH_SECRET: secret, TURNSTILE_SECRET_KEY: 'fixture-secret',
  FACEBOOK_CLIENT_ID: 'fixture-app', FACEBOOK_CLIENT_SECRET: 'fixture-app-secret' };
const envModule = 'data:text/javascript,export const env = globalThis.__socialTestEnv;';
function sourceModule(path, replacements = {}) {
  let source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const { createAuth } = await import(sourceModule('src/lib/auth.ts', {
  './mail': 'data:text/javascript,export const sendPasswordResetMail = async () => {}; export const sendVerificationMail = async () => {};',
  './auth-rate-limit': sourceModule('src/lib/auth-rate-limit.ts'),
  './password-policy': sourceModule('src/lib/password-policy.ts'),
  './reauth': sourceModule('src/lib/reauth.ts'),
  './oauth-tokens': sourceModule('src/lib/oauth-tokens.ts'),
  './password-hash': sourceModule('src/lib/password-hash.ts'),
  './auth-events': sourceModule('src/lib/auth-events.ts', { './auth-alerts': sourceModule('src/lib/auth-alerts.ts') }),
}));
const auth = createAuth();

// Whoever the stubbed Facebook says is signing in.
let facebook = { id: 'fb-0', email: 'nobody@example.test' };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://graph.facebook.com/v24.0/oauth/access_token')) {
    return Response.json({ access_token: 'fixture-access-token', expires_in: 3600, token_type: 'bearer' });
  }
  if (url.startsWith('https://graph.facebook.com/debug_token')) {
    return Response.json({ data: { is_valid: true, app_id: 'fixture-app', user_id: facebook.id } });
  }
  if (url.startsWith('https://graph.facebook.com/me')) {
    return Response.json({ id: facebook.id, name: 'Fixture Person', email: facebook.email, picture: { data: { url: 'https://example.test/p.png' } } });
  }
  if (url.startsWith('https://api.pwnedpasswords.com/range/')) return new Response('');
  throw new Error(`Unexpected request: ${url}`);
};
test.after(() => {
  globalThis.fetch = originalFetch;
  database.close();
  delete globalThis.__socialTestEnv;
});

let addresses = 0;
const freshIp = () => `198.51.100.${++addresses}`;
function request(method, path, body, cookie = '') {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, {
    method, headers: { 'content-type': 'application/json', origin, cookie, 'cf-connecting-ip': freshIp() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
const cookieOf = (response, previous = '') => {
  const jar = new Map(previous.split('; ').filter(Boolean).map((pair) => [pair.split('=')[0], pair]));
  for (const header of response.headers.getSetCookie()) jar.set(header.split('=')[0], header.split(';')[0]);
  return [...jar.values()].join('; ');
};
const sessionCookie = (response) => response.headers.getSetCookie().find((header) => header.startsWith('better-auth.session_token=') && !/max-age=0/i.test(header));

/** Starts a Facebook flow (sign-in, or linking when a cookie is given) and returns its state and cookies. */
async function startFacebook(path, cookie = '') {
  const start = await request('POST', path, { provider: 'facebook', callbackURL: '/account' }, cookie);
  assert.equal(start.status, 200);
  const { url } = await start.json();
  return { state: new URL(url).searchParams.get('state'), cookie: cookieOf(start, cookie) };
}
async function callback(state, cookie, query = 'code=fixture-code') {
  const response = await request('GET', `callback/facebook?${query}&state=${state}`, undefined, cookie);
  assert.equal(response.status, 302);
  return response;
}
async function facebookFlow(path, cookie = '') {
  const { state, cookie: jar } = await startFacebook(path, cookie);
  return callback(state, jar);
}
const errorOf = (response) => new URL(response.headers.get('location'), origin).searchParams.get('error');
const facebookAccounts = (userId) => database.prepare("SELECT * FROM account WHERE userId = ? AND providerId = 'facebook'").all(userId);
const sessionsOf = (userId) => database.prepare('SELECT COUNT(*) AS n FROM session WHERE userId = ?').get(userId).n;

async function passwordMember(id, email) {
  const now = new Date().toISOString();
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run(id, id, email, now, now);
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
    .run(`${id}-cred`, id, id, await hashPassword(`${id}-fixture-password`), now, now);
  const signedIn = await request('POST', 'sign-in/email', { email, password: `${id}-fixture-password` });
  assert.equal(signedIn.status, 200);
  return cookieOf(signedIn);
}
/** A reader who signed up with Facebook and has no password. */
async function facebookReader(id, email) {
  facebook = { id, email };
  const response = await facebookFlow('sign-in/social');
  assert.ok(sessionCookie(response), `sign-up failed: ${response.headers.get('location')}`);
  const user = database.prepare('SELECT id FROM user WHERE email = ?').get(email);
  return { userId: user.id, cookie: cookieOf(response) };
}

test('a provider sign-in with a member’s email address never takes over their account', async () => {
  await passwordMember('victim', 'victim@example.test');
  facebook = { id: 'fb-attacker', email: 'victim@example.test' };
  const response = await facebookFlow('sign-in/social');
  assert.ok(!sessionCookie(response), 'no session is issued');
  assert.ok(errorOf(response), 'the reader lands on an error');
  assert.equal(new URL(response.headers.get('location'), origin).pathname, '/sign-in');
  assert.equal(facebookAccounts('victim').length, 0, 'nothing is linked to the member');
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'victim@example.test'").get().n, 1, 'no second user');
  assert.equal(sessionsOf('victim'), 1, 'only the member’s own session exists');
});

test('a provider identity belongs to one user: linking someone else’s is refused', async () => {
  const owner = await facebookReader('fb-owned', 'owner@example.test');
  const intruder = await passwordMember('intruder', 'owner-lookalike@example.test');
  facebook = { id: 'fb-owned', email: 'owner-lookalike@example.test' };
  const response = await facebookFlow('link-social', intruder);
  assert.equal(errorOf(response), 'account_already_linked_to_different_user');
  assert.equal(facebookAccounts('intruder').length, 0);
  assert.equal(facebookAccounts(owner.userId).length, 1, 'the owner keeps it');

  // And signing in with that identity still opens the owner's account, not the intruder's.
  const again = await facebookFlow('sign-in/social');
  const token = sessionCookie(again).split(';')[0].split('=')[1].split('.')[0];
  assert.equal(database.prepare('SELECT userId FROM session WHERE token = ?').get(decodeURIComponent(token)).userId, owner.userId);
});

test('linking needs the provider to report the account’s own email address', async () => {
  const member = await passwordMember('mismatch', 'mismatch@example.test');
  facebook = { id: 'fb-mismatch', email: 'someone-else@example.test' };
  const response = await facebookFlow('link-social', member);
  assert.equal(errorOf(response), 'email_does_not_match');
  assert.equal(facebookAccounts('mismatch').length, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM account WHERE accountId = 'fb-mismatch'").get().n, 0);
});

test('the callback only completes for the browser that started the flow, once', async (t) => {
  facebook = { id: 'fb-state', email: 'state@example.test' };
  const noUser = () => assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'state@example.test'").get().n, 0);

  await t.test('a made-up state is refused', async () => {
    const { cookie } = await startFacebook('sign-in/social');
    const response = await callback('forged-state-value', cookie);
    assert.ok(!sessionCookie(response));
    assert.ok(errorOf(response));
    noUser();
  });

  await t.test('a real state replayed from another browser (login CSRF) is refused', async () => {
    const { state } = await startFacebook('sign-in/social');
    const response = await callback(state, '');
    assert.ok(!sessionCookie(response));
    assert.ok(errorOf(response));
    noUser();
  });

  await t.test('a provider that reports an error or sends no code signs nobody in', async () => {
    const denied = await startFacebook('sign-in/social');
    const response = await callback(denied.state, denied.cookie, 'error=access_denied');
    assert.ok(!sessionCookie(response));
    assert.equal(new URL(response.headers.get('location'), origin).pathname, '/sign-in');
    const empty = await startFacebook('sign-in/social');
    assert.ok(!sessionCookie(await callback(empty.state, empty.cookie, 'code=')));
    noUser();
  });

  await t.test('a completed state cannot be used a second time', async () => {
    const { state, cookie } = await startFacebook('sign-in/social');
    assert.ok(sessionCookie(await callback(state, cookie)));
    const user = database.prepare("SELECT id FROM user WHERE email = 'state@example.test'").get();
    const before = sessionsOf(user.id);
    const replay = await callback(state, cookie);
    assert.ok(!sessionCookie(replay));
    assert.equal(sessionsOf(user.id), before);
  });
});

test('a suspended reader gets no session from a provider sign-in', async () => {
  const reader = await facebookReader('fb-suspended', 'suspended@example.test');
  database.prepare("INSERT INTO user_suspensions (user_id, reason, created_at, expires_at) VALUES (?, 'fixture', ?, NULL)").run(reader.userId, Date.now());
  const before = sessionsOf(reader.userId);
  const response = await facebookFlow('sign-in/social');
  assert.ok(!sessionCookie(response));
  assert.equal(sessionsOf(reader.userId), before);

  // Once the suspension is lifted, the same identity signs in again.
  database.prepare('DELETE FROM user_suspensions WHERE user_id = ?').run(reader.userId);
  assert.ok(sessionCookie(await facebookFlow('sign-in/social')));
});

test('unlinking keeps at least one way in and only touches the caller’s own accounts', async () => {
  const reader = await facebookReader('fb-only', 'only@example.test');
  const [only] = facebookAccounts(reader.userId);
  // Unlinking needs a fresh session (src/lib/reauth.ts); the provider sign-in just opened one.
  const last = await request('POST', 'unlink-account', { providerId: 'facebook', accountId: only.accountId }, reader.cookie);
  assert.equal(last.status, 400);
  assert.equal((await last.json()).code, 'FAILED_TO_UNLINK_LAST_ACCOUNT');
  assert.equal(facebookAccounts(reader.userId).length, 1);

  const anonymous = await request('POST', 'unlink-account', { providerId: 'facebook', accountId: only.accountId });
  assert.equal(anonymous.status, 401);

  const other = await passwordMember('unlinker', 'unlinker@example.test');
  const foreign = await request('POST', 'unlink-account', { providerId: 'facebook', accountId: only.accountId }, other);
  assert.ok(foreign.status >= 400, `status ${foreign.status}`);
  assert.equal(facebookAccounts(reader.userId).length, 1, 'another user’s link is untouched');
});

test('provider callbacks are logged with their outcome, and nothing that identifies the person', async () => {
  const lines = [];
  const original = { log: console.log, warn: console.warn };
  const capture = (text) => { if (typeof text === 'string' && text.startsWith('{"event":"auth_event"')) lines.push(JSON.parse(text)); };
  console.log = capture;
  console.warn = capture;
  try {
    facebook = { id: 'fb-logged', email: 'logged@example.test' };
    await facebookFlow('sign-in/social');
    const { state } = await startFacebook('sign-in/social');
    await callback(state, '');
    const member = await passwordMember('linker', 'linker@example.test');
    facebook = { id: 'fb-linker', email: 'linker@example.test' };
    const linked = await facebookFlow('link-social', member);
    assert.equal(errorOf(linked), null);
  } finally {
    Object.assign(console, original);
  }
  const callbacks = lines.filter((line) => ['social_sign_in', 'social_callback', 'link_account'].includes(line.type));
  assert.deepEqual(callbacks.map(({ type, outcome, code }) => ({ type, outcome, code })), [
    { type: 'social_sign_in', outcome: 'success', code: undefined },
    { type: 'social_callback', outcome: 'failure', code: 'state_mismatch' },
    { type: 'link_account', outcome: 'success', code: undefined },
  ]);
  assert.ok(lines.some((line) => line.type === 'link_account_start' && line.user === 'linker'));
  const text = JSON.stringify(lines);
  for (const value of ['logged@example.test', 'linker@example.test', 'fb-logged', 'fb-linker', 'fixture-access-token', 'fixture-code']) {
    assert.ok(!text.includes(value), `${value} must not be logged`);
  }
});
