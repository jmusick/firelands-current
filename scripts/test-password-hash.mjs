import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword as legacyHash } from 'better-auth/crypto';

// Password hashing (src/lib/password-hash.ts): the current profile, legacy Better Auth hashes, fail-closed
// parsing, the upgrade on sign-in and /reauth, and that every path that sets a password (sign-up, change,
// reset, admin Add user and Set password) writes the same format. Real Better Auth handlers, site
// middleware and admin endpoints run against an isolated in-memory database; nothing is sent.

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
let failWrites = false;
const db = {
  exec: (sql) => database.exec(sql),
  prepare(sql) {
    let values = [];
    const statement = database.prepare(sql);
    const query = {
      bind(...args) { values = args; return query; },
      async all() { return { results: statement.all(...values), meta: { changes: 0 } }; },
      async first() { return statement.get(...values) ?? null; },
      async run() {
        if (failWrites) throw new Error('D1 unavailable');
        return { meta: statement.run(...values) };
      },
    };
    return query;
  },
  async batch(statements) { const out = []; for (const statement of statements) out.push(await statement.all()); return out; },
};
const origin = 'http://localhost:4321';
const mail = [];
globalThis.__hashTestEnv = { DB: db, SITE_URL: origin,
  BETTER_AUTH_SECRET: 'password-hash-regression-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fixture-secret' };
globalThis.__hashTestMail = mail;
const envModule = 'data:text/javascript,export const env = globalThis.__hashTestEnv;';
function sourceModule(path, replacements = {}) {
  let source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const hashModule = sourceModule('src/lib/password-hash.ts');
const rateLimit = sourceModule('src/lib/auth-rate-limit.ts');
const policyModule = sourceModule('src/lib/password-policy.ts');
const reauthModule = sourceModule('src/lib/reauth.ts');
const staffModule = sourceModule('src/lib/staff.ts');
const adminModule = sourceModule('src/lib/admin.ts');
const forumModule = sourceModule('src/lib/forum.ts');
const bodyModule = sourceModule('src/lib/request-body.ts');
const authModule = sourceModule('src/lib/auth.ts', {
  './auth-events': sourceModule('src/lib/auth-events.ts', { './auth-alerts': sourceModule('src/lib/auth-alerts.ts') }),
  './mail': 'data:text/javascript,export const sendPasswordResetMail = async (user, url) => globalThis.__hashTestMail.push({ user, url }); export const sendVerificationMail = async () => {};',
  './auth-rate-limit': rateLimit, './password-policy': policyModule, './reauth': reauthModule,
  './oauth-tokens': sourceModule('src/lib/oauth-tokens.ts'), './password-hash': hashModule,
});
const usersModule = sourceModule('src/lib/users.ts', {
  './auth': authModule, './forum': forumModule, './staff': staffModule, './password-policy': policyModule, './password-hash': hashModule,
});
const { CURRENT, hashPassword, needsRehash, upgradePasswordHash, verifyPassword } = await import(hashModule);
const { createAuth } = await import(authModule);
const usersApi = await import(sourceModule('src/pages/api/admin/users.ts', {
  '../../../lib/request-body': bodyModule, '../../../lib/admin': adminModule, '../../../lib/forum': forumModule,
  '../../../lib/audit': sourceModule('src/lib/audit.ts'), '../../../lib/password-policy': policyModule,
  '../../../lib/reauth': reauthModule, '../../../lib/staff': staffModule, '../../../lib/users': usersModule,
  '../../../lib/tip-retention': sourceModule('src/lib/tip-retention.ts'),
}));
const reauthApi = await import(sourceModule('src/pages/api/reauth.ts', {
  '../../lib/forum': forumModule, '../../lib/quotas': sourceModule('src/lib/quotas.ts', { './auth-rate-limit': rateLimit }),
  '../../lib/password-policy': policyModule, '../../lib/reauth': reauthModule, '../../lib/request-body': bodyModule, '../../lib/users': usersModule,
}));
const { onRequest } = await import(sourceModule('src/middleware.ts', {
  'astro:middleware': 'data:text/javascript,export const defineMiddleware = handler => handler;',
  './lib/auth': authModule, './lib/staff': staffModule, './lib/response-headers': sourceModule('src/lib/response-headers.ts'),
}));

// Only Turnstile is reached over the network.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  return Response.json({ success: true });
};
// Every line the code under test writes, to prove no password or hash reaches the logs.
const logged = [];
const originalConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
for (const level of Object.keys(originalConsole)) console[level] = (...args) => { logged.push(args.map(String).join(' ')); };
test.after(() => {
  Object.assign(console, originalConsole);
  globalThis.fetch = originalFetch;
  database.close();
  delete globalThis.__hashTestEnv;
  delete globalThis.__hashTestMail;
});

const PHC = /^\$scrypt\$ln=14,r=8,p=5\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;
const LEGACY = /^[0-9a-f]{32}:[0-9a-f]{128}$/;
let addresses = 0;
const freshIp = () => { assert.ok(++addresses < 255); return `192.0.2.${addresses}`; };
function post(path, body, cookie = '', captcha = false) {
  return createAuth().handler(new Request(`${origin}/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, 'cf-connecting-ip': freshIp(),
      ...(captcha ? { 'x-captcha-response': 'fixture-token' } : {}) }, body: JSON.stringify(body),
  }));
}
const cookieOf = (response) => response.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
async function signIn(email, password) {
  const response = await post('sign-in/email', { email, password });
  assert.equal(response.status, 200);
  return cookieOf(response);
}
async function endpoint(handler, path, cookie, fields) {
  const url = new URL(path, origin);
  const request = new Request(url, { method: 'POST', body: new URLSearchParams(fields),
    headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': freshIp() } });
  const context = { url, request, locals: {}, redirect: (location) => new Response(null, { status: 302, headers: { Location: location } }) };
  return onRequest(context, () => handler(context));
}
const stored = (userId) => database.prepare("SELECT password, updatedAt FROM account WHERE userId = ? AND providerId = 'credential'").get(userId);
const now = new Date().toISOString();
async function account(id, password, { hash, role, verified = true } = {}) {
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, `Person ${id}`, `${id}@example.test`, verified ? 1 : 0, now, now);
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
    .run(`${id}-account`, id, id, hash ?? await legacyHash(password), now, now);
  if (role) database.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?)').run(id, role, Date.now());
}

test('hash format and verification', async (t) => {
  await t.test('new hashes are self-describing scrypt at the current profile, salted, and verify', async () => {
    assert.deepEqual({ ...CURRENT }, { ln: 14, r: 8, p: 5 });
    const one = await hashPassword('a perfectly ordinary passphrase');
    const two = await hashPassword('a perfectly ordinary passphrase');
    assert.match(one, PHC);
    assert.notEqual(one, two);
    assert.equal(await verifyPassword({ hash: one, password: 'a perfectly ordinary passphrase' }), true);
    assert.equal(await verifyPassword({ hash: two, password: 'a perfectly ordinary passphrase' }), true);
    assert.equal(needsRehash(one), false);
  });

  await t.test('the wrong password fails for new and legacy hashes', async () => {
    const current = await hashPassword('the right passphrase here');
    const legacy = await legacyHash('the right passphrase here');
    for (const hash of [current, legacy]) {
      for (const password of ['the wrong passphrase here', 'the right passphrase her', 'the right passphrase here ', '']) {
        assert.equal(await verifyPassword({ hash, password }), false, password);
      }
    }
  });

  await t.test('legacy Better Auth hashes still verify, Unicode normalization included, and are due a rehash', async () => {
    const legacy = await legacyHash('café au lait every morning');
    assert.match(legacy, LEGACY);
    assert.equal(await verifyPassword({ hash: legacy, password: 'café au lait every morning' }), true);
    // The same text typed with a combining accent normalizes to the same password, as it always did.
    assert.equal(await verifyPassword({ hash: legacy, password: 'café au lait every morning' }), true);
    assert.equal(needsRehash(legacy), true);
    const current = await hashPassword('café au lait every morning');
    assert.equal(await verifyPassword({ hash: current, password: 'café au lait every morning' }), true);
  });

  await t.test('malformed, tampered, or out-of-bounds hashes fail closed without throwing', async () => {
    const good = await hashPassword('fail closed passphrase');
    const legacy = await legacyHash('fail closed passphrase');
    const [, , params, salt, key] = good.split('$');
    const flip = (text) => text.slice(0, -2) + (text.at(-2) === '0' ? '1' : '0') + text.at(-1);
    // Well formed but altered: the key no longer matches.
    for (const hash of [flip(good), `$scrypt$${params}$${flip(salt)}$${key}`, flip(legacy), `${flip(legacy.split(':')[0])}:${legacy.split(':')[1]}`]) {
      assert.equal(await verifyPassword({ hash, password: 'fail closed passphrase' }), false, hash);
    }
    const bad = [
      '', 'not a hash', ':', 'abc:def', legacy.toUpperCase(), legacy.slice(0, -2), `${legacy}00`, `${legacy.split(':')[0]}:`,
      `$scrypt$${params}$${salt}`, `$scrypt$${params}$$${key}`,
      `$scrypt$ln=30,r=8,p=1$${salt}$${key}`, `$scrypt$ln=17,r=8,p=1$${salt}$${key}`, `$scrypt$ln=14,r=8,p=99$${salt}$${key}`,
      `$scrypt$ln=14,r=0,p=5$${salt}$${key}`, `$scrypt$ln=4,r=8,p=5$${salt}$${key}`, `$scrypt$ln=14,r=8,p=5$${salt}==$${key}`,
      `$scrypt$ln=14,r=8,p=5$${salt.slice(0, 10)}$${key}`, `$scrypt$ln=14,r=8,p=5$${salt}$${key.slice(0, 20)}`,
      `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${key}`, ` ${good}`, `${good}\n`, null, undefined, 42,
    ];
    for (const hash of bad) {
      assert.equal(await verifyPassword({ hash, password: 'fail closed passphrase' }), false, String(hash));
      if (typeof hash === 'string') assert.equal(needsRehash(hash), true, hash);
    }
  });

  await t.test('keys are compared in constant time', () => {
    const source = readFileSync(new URL('../src/lib/password-hash.ts', import.meta.url), 'utf8');
    assert.match(source, /timingSafeEqual\(key, parsed\.key\)/);
  });
});

test('legacy hashes are replaced on a successful sign-in or confirmation', async (t) => {
  await t.test('a password sign-in rewrites a legacy hash once; the password keeps working', async () => {
    const password = 'legacy sign in passphrase';
    await account('legacy-sign-in', password);
    const before = stored('legacy-sign-in');
    assert.match(before.password, LEGACY);
    await signIn('legacy-sign-in@example.test', password);
    const after = stored('legacy-sign-in');
    assert.match(after.password, PHC);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(await verifyPassword({ hash: after.password, password }), true);
    await signIn('legacy-sign-in@example.test', password);
    assert.equal(stored('legacy-sign-in').password, after.password);
  });

  await t.test('a refused sign-in leaves the legacy hash alone', async () => {
    await account('legacy-refused', 'legacy refused passphrase');
    await account('legacy-unverified', 'legacy unverified passphrase', { verified: false });
    const wrong = stored('legacy-refused').password;
    const unverified = stored('legacy-unverified').password;
    assert.equal((await post('sign-in/email', { email: 'legacy-refused@example.test', password: 'not the passphrase at all' })).status, 401);
    assert.equal((await post('sign-in/email', { email: 'legacy-unverified@example.test', password: 'legacy unverified passphrase' })).status, 403);
    assert.equal(stored('legacy-refused').password, wrong);
    assert.equal(stored('legacy-unverified').password, unverified);
  });

  await t.test('confirming a password at /reauth rewrites a legacy hash; a wrong one does not', async () => {
    const password = 'legacy reauth passphrase';
    await account('legacy-reauth', password);
    // Sign in against a current hash, then put a legacy one back as if the session predated the upgrade.
    const cookie = await signIn('legacy-reauth@example.test', password);
    const legacy = await legacyHash(password);
    database.prepare("UPDATE account SET password = ? WHERE userId = 'legacy-reauth'").run(legacy);
    const wrong = await endpoint(reauthApi.POST, '/api/reauth', cookie, { password: 'not the passphrase at all', next: '/account' });
    assert.equal(wrong.status, 303);
    assert.equal(new URL(wrong.headers.get('Location'), origin).searchParams.get('error'), 'password');
    assert.equal(stored('legacy-reauth').password, legacy);
    const ok = await endpoint(reauthApi.POST, '/api/reauth', cookie, { password, next: '/account' });
    assert.equal(new URL(ok.headers.get('Location'), origin).pathname, '/account');
    assert.match(stored('legacy-reauth').password, PHC);
  });

  await t.test('the upgrade never overwrites a hash that changed after the password was checked', async () => {
    await account('raced', 'the old raced passphrase');
    // Someone else set a new password (on an older deployment, so still legacy) between the check and the upgrade.
    const replaced = await legacyHash('the new raced passphrase');
    database.prepare("UPDATE account SET password = ? WHERE userId = 'raced'").run(replaced);
    assert.equal(await upgradePasswordHash('raced', 'the old raced passphrase'), false);
    assert.equal(stored('raced').password, replaced);
    // A current hash is left as it is.
    const current = await hashPassword('the newest raced passphrase');
    database.prepare("UPDATE account SET password = ? WHERE userId = 'raced'").run(current);
    assert.equal(await upgradePasswordHash('raced', 'the newest raced passphrase'), false);
    assert.equal(stored('raced').password, current);
    assert.equal(await upgradePasswordHash('no-such-user', 'whatever passphrase'), false);
  });

  await t.test('a failed upgrade keeps the legacy hash, still signs in, and logs only the event name', async () => {
    const password = 'unlucky upgrade passphrase';
    await account('unlucky', password);
    const legacy = stored('unlucky').password;
    const lines = logged.length;
    failWrites = true;
    try {
      assert.equal(await upgradePasswordHash('unlucky', password), false);
    } finally { failWrites = false; }
    assert.equal(stored('unlucky').password, legacy);
    assert.deepEqual(logged.slice(lines).map((line) => JSON.parse(line)), [{ event: 'password_rehash_failed' }]);
    assert.equal(await verifyPassword({ hash: legacy, password }), true);
  });
});

test('every way of setting a password writes the current format', async (t) => {
  await t.test('sign-up, change, and reset through Better Auth', async () => {
    assert.equal((await post('sign-up/email', { name: 'New Reader', email: 'new-reader@example.test', password: 'a new reader passphrase' }, '', true)).status, 200);
    const userId = database.prepare("SELECT id FROM user WHERE email = 'new-reader@example.test'").get().id;
    assert.match(stored(userId).password, PHC);
    database.prepare('UPDATE user SET emailVerified = 1 WHERE id = ?').run(userId);
    const cookie = await signIn('new-reader@example.test', 'a new reader passphrase');

    const changed = await post('change-password', { currentPassword: 'a new reader passphrase', newPassword: 'a changed reader passphrase' }, cookie);
    assert.equal(changed.status, 200);
    assert.match(stored(userId).password, PHC);
    assert.equal(await verifyPassword({ hash: stored(userId).password, password: 'a changed reader passphrase' }), true);

    assert.equal((await post('request-password-reset', { email: 'new-reader@example.test', redirectTo: '/reset-password' }, '', true)).status, 200);
    const token = new URL(mail.at(-1).url).pathname.split('/').at(-1);
    assert.equal((await post('reset-password', { token, newPassword: 'a reset reader passphrase' })).status, 200);
    assert.match(stored(userId).password, PHC);
    await signIn('new-reader@example.test', 'a reset reader passphrase');
  });

  await t.test('a legacy current password still allows a change', async () => {
    await account('legacy-changer', 'legacy changer passphrase');
    const cookie = await signIn('legacy-changer@example.test', 'legacy changer passphrase');
    database.prepare("UPDATE account SET password = ? WHERE userId = 'legacy-changer'").run(await legacyHash('legacy changer passphrase'));
    const changed = await post('change-password', { currentPassword: 'legacy changer passphrase', newPassword: 'a fresh changer passphrase' }, cookie);
    assert.equal(changed.status, 200);
    assert.match(stored('legacy-changer').password, PHC);
  });

  await t.test('admin Add user and Set password', async () => {
    await account('chief', 'chief admin passphrase', { role: 'admin' });
    const chief = await signIn('chief@example.test', 'chief admin passphrase');
    const created = await endpoint(usersApi.POST, '/api/admin/users', chief,
      { action: 'create', name: 'Temporary Staff', email: 'temporary-staff@example.test', password: 'a temporary staff passphrase 7' });
    assert.equal(created.status, 303);
    const id = database.prepare("SELECT id FROM user WHERE email = 'temporary-staff@example.test'").get().id;
    assert.match(stored(id).password, PHC);
    await signIn('temporary-staff@example.test', 'a temporary staff passphrase 7');

    await account('helped', 'helped person passphrase');
    const set = await endpoint(usersApi.POST, '/api/admin/users', chief,
      { action: 'set-password', userId: 'helped', password: 'a replacement helped passphrase' });
    assert.equal(new URL(set.headers.get('Location'), origin).searchParams.get('notice'), 'password');
    assert.match(stored('helped').password, PHC);
    await signIn('helped@example.test', 'a replacement helped passphrase');
  });
});

test('no password or hash is ever logged', () => {
  const hashes = database.prepare('SELECT password FROM account WHERE password IS NOT NULL').all().map((row) => row.password);
  assert.ok(hashes.length > 5);
  const text = logged.join('\n');
  for (const secret of [...hashes, ...hashes.map((hash) => hash.split(/[:$]/).at(-1)), 'passphrase']) {
    assert.equal(text.includes(secret), false, 'a password or hash reached the logs');
  }
});
