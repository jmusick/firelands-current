import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword } from 'better-auth/crypto';

// Provider tokens are not retained: the database hooks drop them on every account write, a migration
// clears what earlier sign-ins stored, and provider sign-in, linking, and unlinking still work without
// them. Runs the real Better Auth handlers against an isolated in-memory database with a stubbed Facebook.

function openDatabase(upTo = Infinity) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const names = readdirSync(new URL('../migrations/', import.meta.url)).sort();
  const applied = [];
  for (const name of names) {
    if (Number.parseInt(name, 10) > upTo) break;
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    applied.push(name);
  }
  return { database, applied };
}
const { database } = openDatabase();
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
const secret = 'oauth-token-regression-secret-at-least-32-characters';
globalThis.__oauthTestEnv = { DB: db, SITE_URL: origin, BETTER_AUTH_SECRET: secret, TURNSTILE_SECRET_KEY: 'fixture-secret',
  FACEBOOK_CLIENT_ID: 'fixture-app', FACEBOOK_CLIENT_SECRET: 'fixture-app-secret' };
const envModule = 'data:text/javascript,export const env = globalThis.__oauthTestEnv;';
function sourceModule(path, replacements = {}) {
  let source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const tokensModule = sourceModule('src/lib/oauth-tokens.ts');
const { withoutOAuthTokens } = await import(tokensModule);
const { createAuth } = await import(sourceModule('src/lib/auth.ts', {
  './mail': 'data:text/javascript,export const sendPasswordResetMail = async () => {}; export const sendVerificationMail = async () => {};',
  './auth-rate-limit': sourceModule('src/lib/auth-rate-limit.ts'),
  './password-policy': sourceModule('src/lib/password-policy.ts'),
  './reauth': sourceModule('src/lib/reauth.ts'),
  './oauth-tokens': tokensModule,
  './auth-events': sourceModule('src/lib/auth-events.ts'),
}));
const auth = createAuth();

const SECRETS = ['fixture-access-token', 'fixture-refresh-token', 'fixture-id-token'];
// The Facebook endpoints the callback talks to. The token reply hands back every kind of token so a leak shows.
let facebookUserId = 'fb-1001';
let facebookEmail = 'reader@example.test';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://graph.facebook.com/v24.0/oauth/access_token')) {
    return Response.json({ access_token: SECRETS[0], refresh_token: SECRETS[1], expires_in: 3600, token_type: 'bearer' });
  }
  if (url.startsWith('https://graph.facebook.com/debug_token')) {
    return Response.json({ data: { is_valid: true, app_id: 'fixture-app', user_id: facebookUserId } });
  }
  if (url.startsWith('https://graph.facebook.com/me')) {
    return Response.json({ id: facebookUserId, name: 'Fixture Reader', email: facebookEmail, picture: { data: { url: 'https://example.test/p.png' } } });
  }
  if (url.startsWith('https://api.pwnedpasswords.com/range/')) return new Response('');
  throw new Error(`Unexpected request: ${url}`);
};
test.after(() => {
  globalThis.fetch = originalFetch;
  database.close();
  delete globalThis.__oauthTestEnv;
});

let addresses = 0;
const freshIp = () => `192.0.2.${++addresses}`;
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
/** Starts a Facebook flow (sign-in, or linking when a cookie is given) and finishes the callback. */
async function facebookFlow(path, cookie = '') {
  const start = await request('POST', path, { provider: 'facebook', callbackURL: '/account' }, cookie);
  assert.equal(start.status, 200);
  const { url } = await start.json();
  const state = new URL(url).searchParams.get('state');
  const jar = cookieOf(start, cookie);
  const callback = await request('GET', `callback/facebook?code=fixture-code&state=${state}`, undefined, jar);
  assert.equal(callback.status, 302);
  return { callback, cookie: cookieOf(callback, jar) };
}
const accounts = (userId) => database.prepare("SELECT * FROM account WHERE userId = ? AND providerId = 'facebook'").all(userId);
function assertNoTokens(row) {
  for (const field of ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt']) {
    assert.equal(row[field], null, `${field} must not be stored`);
  }
}
function assertNoSecretInDatabase() {
  const dump = JSON.stringify(database.prepare('SELECT * FROM account').all());
  for (const value of SECRETS) assert.ok(!dump.includes(value), `${value} found in the account table`);
}

test('withoutOAuthTokens clears only the token fields a write carries', () => {
  assert.equal(withoutOAuthTokens({ providerId: 'facebook', accountId: '1', scope: 'email' }), undefined);
  assert.equal(withoutOAuthTokens({ accessToken: null, refreshToken: undefined }), undefined);
  assert.deepEqual(withoutOAuthTokens({ accessToken: 'a', scope: 'email' }), { data: { accessToken: null } });
  assert.deepEqual(
    withoutOAuthTokens({ accessToken: 'a', refreshToken: 'r', idToken: 'i', accessTokenExpiresAt: new Date(), refreshTokenExpiresAt: new Date(), providerId: 'x' }),
    { data: { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } },
  );
});

test('the auth configuration encrypts tokens should any be stored, and registers the clearing hooks', async () => {
  const context = await auth.$context;
  assert.equal(context.options.account.encryptOAuthTokens, true);
  assert.equal(typeof context.options.databaseHooks.account.create.before, 'function');
  assert.equal(typeof context.options.databaseHooks.account.update.before, 'function');
});

test('account writes through Better Auth never keep tokens, however they arrive', async () => {
  const context = await auth.$context;
  const now = new Date().toISOString();
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run('direct', 'Direct', 'direct@example.test', now, now);
  const tokens = { accessToken: SECRETS[0], refreshToken: SECRETS[1], idToken: SECRETS[2],
    accessTokenExpiresAt: new Date(Date.now() + 3600000), refreshTokenExpiresAt: new Date(Date.now() + 86400000) };
  const created = await context.internalAdapter.createAccount({ userId: 'direct', providerId: 'google', accountId: 'g-1', scope: 'openid,email', ...tokens });
  assertNoTokens(database.prepare('SELECT * FROM account WHERE id = ?').get(created.id));
  await context.internalAdapter.updateAccount(created.id, tokens);
  const row = database.prepare('SELECT * FROM account WHERE id = ?').get(created.id);
  assertNoTokens(row);
  assert.equal(row.scope, 'openid,email', 'scope is kept');
  const linked = await context.internalAdapter.linkAccount({ userId: 'direct', providerId: 'microsoft', accountId: 'm-1', ...tokens });
  assertNoTokens(database.prepare('SELECT * FROM account WHERE id = ?').get(linked.id));
  assertNoSecretInDatabase();
});

test('provider sign-in, repeat sign-in, linking, and unlinking work with no stored tokens', async () => {
  // A new reader signs up with Facebook.
  const first = await facebookFlow('sign-in/social');
  assert.match(first.cookie, /better-auth\.session_token=/);
  const user = database.prepare("SELECT id FROM user WHERE email = 'reader@example.test'").get();
  assert.ok(user);
  let rows = accounts(user.id);
  assert.equal(rows.length, 1);
  assertNoTokens(rows[0]);

  // Signing in again refreshes the account row, which is where tokens would otherwise be rewritten.
  const again = await facebookFlow('sign-in/social');
  assert.match(again.cookie, /better-auth\.session_token=/);
  rows = accounts(user.id);
  assert.equal(rows.length, 1);
  assertNoTokens(rows[0]);

  // An email/password member links Facebook from their account page, then unlinks it again.
  const now = new Date().toISOString();
  facebookUserId = 'fb-2002';
  facebookEmail = 'member@example.test';
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run('member', 'Member', facebookEmail, now, now);
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('member-cred', 'member', 'credential', 'member', ?, ?, ?)")
    .run(await hashPassword('member-fixture-password'), now, now);
  const signedIn = await request('POST', 'sign-in/email', { email: facebookEmail, password: 'member-fixture-password' });
  assert.equal(signedIn.status, 200);
  const session = cookieOf(signedIn);
  const linked = await facebookFlow('link-social', session);
  assert.ok(!linked.callback.headers.get('location').includes('error='), linked.callback.headers.get('location'));
  rows = accounts('member');
  assert.equal(rows.length, 1);
  assertNoTokens(rows[0]);

  const unlink = await request('POST', 'unlink-account', { accountId: rows[0].id }, session);
  assert.equal(unlink.status, 200);
  assert.equal(accounts('member').length, 0);
  assert.ok(database.prepare("SELECT 1 FROM account WHERE userId = 'member' AND providerId = 'credential'").get());
  assertNoSecretInDatabase();
});

test('the migration clears tokens stored by earlier sign-ins and leaves linked sign-in intact', () => {
  const { database: old, applied } = openDatabase(25);
  assert.equal(applied.at(-1), '0025_session_reauth.sql');
  const now = new Date().toISOString();
  old.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('u1', 'U', 'u@example.test', now, now);
  old.prepare(`INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, createdAt, updatedAt)
    VALUES ('a1', 'g-1', 'google', 'u1', 'plain-access', 'plain-refresh', 'a.b.c', ?, ?, 'openid,email', ?, ?)`).run(now, now, now, now);
  old.prepare(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a2', 'u1', 'credential', 'u1', 'hash', ?, ?)`).run(now, now);
  const migration = readFileSync(new URL('../migrations/0026_clear_oauth_tokens.sql', import.meta.url), 'utf8');
  old.exec(migration);
  old.exec(migration);
  const [google, credential] = old.prepare('SELECT * FROM account ORDER BY id').all();
  assertNoTokens(google);
  assert.equal(google.providerId, 'google');
  assert.equal(google.accountId, 'g-1');
  assert.equal(google.scope, 'openid,email');
  assert.equal(credential.password, 'hash');
  old.close();
});
