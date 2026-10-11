import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword } from 'better-auth/crypto';

// Recent reauthentication for privileged actions, session revocation when a staff role gains access, and
// the password policy (length and predictable values), through the real Better Auth handlers,
// the site middleware, and the admin endpoints against an isolated in-memory database.

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
const mail = [];
globalThis.__freshTestEnv = { DB: db, SITE_URL: origin,
  BETTER_AUTH_SECRET: 'fresh-auth-regression-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fixture-secret' };
globalThis.__freshTestMail = mail;
const envModule = 'data:text/javascript,export const env = globalThis.__freshTestEnv;';
function sourceModule(path, replacements = {}, page = false) {
  let source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  if (page) {
    const frontmatter = source.split('---')[1];
    const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
    source = `${imports.join('\n')}\nexport async function render(Astro) {\n${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn new Response('Authorized');\n}`;
  }
  source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const rateLimit = sourceModule('src/lib/auth-rate-limit.ts');
const policyModule = sourceModule('src/lib/password-policy.ts');
const reauthModule = sourceModule('src/lib/reauth.ts');
const staffModule = sourceModule('src/lib/staff.ts');
const adminModule = sourceModule('src/lib/admin.ts');
const forumModule = sourceModule('src/lib/forum.ts');
const bodyModule = sourceModule('src/lib/request-body.ts');
const authEventsModule = sourceModule('src/lib/auth-events.ts');
const auditModule = sourceModule('src/lib/audit.ts');
const authModule = sourceModule('src/lib/auth.ts', {
  './auth-events': authEventsModule,
  './mail': 'data:text/javascript,export const sendPasswordResetMail = async (user, url) => globalThis.__freshTestMail.push({ user, url }); export const sendVerificationMail = async () => {};',
  './auth-rate-limit': rateLimit, './password-policy': policyModule, './reauth': reauthModule,
  './oauth-tokens': sourceModule('src/lib/oauth-tokens.ts'),
});
const usersModule = sourceModule('src/lib/users.ts', { './auth': authModule, './forum': forumModule, './staff': staffModule, './password-policy': policyModule });
const quotasModule = sourceModule('src/lib/quotas.ts', { './auth-rate-limit': rateLimit });
const { createAuth } = await import(authModule);
const { isFresh, recordReauth, safeNext, reauthPath, REAUTH_WINDOW_MS } = await import(reauthModule);
const { isPredictable, passwordProblem, MIN_PASSWORD } = await import(policyModule);
const { gainsAccess } = await import(adminModule);
const usersApi = await import(sourceModule('src/pages/api/admin/users.ts', {
  '../../../lib/request-body': bodyModule, '../../../lib/admin': adminModule, '../../../lib/forum': forumModule, '../../../lib/audit': auditModule,
  '../../../lib/password-policy': policyModule, '../../../lib/reauth': reauthModule, '../../../lib/staff': staffModule,
  '../../../lib/users': usersModule,
}));
const reauthApi = await import(sourceModule('src/pages/api/reauth.ts', {
  '../../lib/forum': forumModule, '../../lib/quotas': quotasModule, '../../lib/password-policy': policyModule,
  '../../lib/reauth': reauthModule, '../../lib/request-body': bodyModule, '../../lib/users': usersModule,
}));
const newUserPage = await import(sourceModule('src/pages/admin/users/new.astro', {
  '../../../lib/admin': adminModule, '../../../lib/password-policy': policyModule, '../../../lib/reauth': reauthModule,
}, true));
const reauthPage = await import(sourceModule('src/pages/reauth.astro', { '../lib/auth': authModule, '../lib/reauth': reauthModule }, true));
const { onRequest } = await import(sourceModule('src/middleware.ts', {
  'astro:middleware': 'data:text/javascript,export const defineMiddleware = handler => handler;',
  './lib/auth': authModule, './lib/staff': staffModule, './lib/response-headers': sourceModule('src/lib/response-headers.ts'),
}));

// Only Turnstile is reached over the network; the password blocklist is local.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const target = String(url);
  assert.equal(target, 'https://challenges.cloudflare.com/turnstile/v0/siteverify', `unexpected request to ${target}`);
  return Response.json({ success: true });
};
test.after(() => {
  globalThis.fetch = originalFetch;
  database.close();
  delete globalThis.__freshTestEnv;
  delete globalThis.__freshTestMail;
});

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
// Runs the middleware so locals come from the real session, then hands the request to the handler.
async function endpoint(handler, path, cookie, fields, headers = {}) {
  const url = new URL(path, origin);
  const request = new Request(url, { method: 'POST', body: new URLSearchParams(fields),
    headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '198.51.100.1', ...headers } });
  const context = { url, request, locals: {}, redirect: (location) => new Response(null, { status: 302, headers: { Location: location } }) };
  return onRequest(context, () => handler(context));
}
const adminPost = (cookie, fields, headers) => endpoint(usersApi.POST, '/api/admin/users', cookie, fields, headers);
const reauthPost = (cookie, fields, headers) => endpoint(reauthApi.POST, '/api/reauth', cookie, fields, headers);
async function render(pageModule, path, cookie) {
  const url = new URL(path, origin);
  const context = { url, request: new Request(url, { headers: { cookie } }), locals: {}, params: {},
    redirect: (location) => new Response(null, { status: 302, headers: { Location: location } }) };
  const response = await onRequest(context, () => pageModule.render(context));
  return { response, locals: context.locals };
}
const where = (response) => new URL(response.headers.get('Location'), origin);
const sessionOf = (cookie) => {
  const token = decodeURIComponent(cookie.split('=')[1].split('.')[0]);
  return database.prepare('SELECT id FROM session WHERE token = ?').get(token).id;
};
const age = (cookie, ms) => database.prepare('UPDATE session_reauth SET reauthenticated_at = ? WHERE session_id = ?').run(Date.now() - ms, sessionOf(cookie));
const sessions = (id) => database.prepare('SELECT COUNT(*) AS n FROM session WHERE userId = ?').get(id).n;
const roleOf = (id) => database.prepare('SELECT role FROM staff_roles WHERE user_id = ?').get(id)?.role ?? null;
const lastAudit = (id, action) => database.prepare('SELECT detail, actor_id FROM admin_audit_log WHERE target_user_id = ? AND action = ? ORDER BY rowid DESC').get(id, action);
const clearThrottles = () => database.exec('DELETE FROM auth_rate_limits');

const BOSS_PASSWORD = 'boss-long-passphrase-for-tests';
const now = new Date().toISOString();
async function account(id, { role = null, password = `${id}-long-passphrase-for-tests` } = {}) {
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, `Person ${id}`, `${id}@example.test`, now, now);
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
    .run(id, id, id, await hashPassword(password), now, now);
  if (role) database.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?)').run(id, role, Date.now());
  return password;
}

test('reauthentication window and return paths', async (t) => {
  await t.test('next must be a same-origin path, never /reauth itself', () => {
    for (const good of ['/admin/users/abc', '/admin/users/abc?x=1&y=2', '/account#link']) assert.equal(safeNext(good), good);
    for (const bad of ['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example/x', 'javascript:alert(1)', 'admin', '',
      null, undefined, '/\t/evil.example', '/ok\nLocation: https://evil.example', `/${'a'.repeat(3000)}`, '/reauth', '/reauth?next=/x', '/reauth/']) {
      assert.equal(safeNext(bad), '/account', JSON.stringify(bad));
    }
    assert.equal(safeNext('//evil.example', '/admin'), '/admin');
    assert.equal(reauthPath('/admin/users/abc', 'role'), '/reauth?next=%2Fadmin%2Fusers%2Fabc&reason=role');
    assert.equal(reauthPath('//evil.example', 'nonsense'), '/reauth?next=%2Faccount');
  });

  await t.test('a password sign-in is fresh, ages out after the window, and a session opened another way never is', async () => {
    await account('window');
    const cookie = await signIn('window@example.test', 'window-long-passphrase-for-tests');
    const id = sessionOf(cookie);
    assert.equal(await isFresh(id), true);
    age(cookie, REAUTH_WINDOW_MS - 60000);
    assert.equal(await isFresh(id), true);
    age(cookie, REAUTH_WINDOW_MS + 1000);
    assert.equal(await isFresh(id), false);
    await recordReauth(id);
    assert.equal(await isFresh(id), true);
    assert.equal(REAUTH_WINDOW_MS, 15 * 60 * 1000);
    // A session created some other way (an emailed verification link, say) has no proof recorded.
    database.prepare("INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('link-session', ?, 'link-token', ?, ?, 'window')")
      .run(new Date(Date.now() + 86400000).toISOString(), now, now);
    assert.equal(await isFresh('link-session'), false);
    assert.equal(await isFresh(null), false);
    assert.equal(await isFresh('no-such-session'), false);
    // The proof leaves with the session.
    database.prepare("DELETE FROM session WHERE id = ?").run(id);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM session_reauth WHERE session_id = ?').get(id).n, 0);
  });

  await t.test('changing a password signs in again and counts as proof', async () => {
    await account('changer');
    const cookie = await signIn('changer@example.test', 'changer-long-passphrase-for-tests');
    const response = await post('change-password', { currentPassword: 'changer-long-passphrase-for-tests', newPassword: 'changer-another-passphrase-for-tests', revokeOtherSessions: true }, cookie);
    assert.equal(response.status, 200);
    const next = cookieOf(response);
    assert.equal(await isFresh(sessionOf(next)), true);
  });
});

test('privileged staff actions need a recent password confirmation', async (t) => {
  await account('boss', { role: 'admin' });
  await account('target');
  await account('other');
  const bossCookie = await signIn('boss@example.test', BOSS_PASSWORD);
  for (let open = 0; open < 2; open++) await signIn('target@example.test', 'target-long-passphrase-for-tests');
  const otherCookie = await signIn('other@example.test', 'other-long-passphrase-for-tests');
  const strongPassword = 'a brand new temporary passphrase 91';

  await t.test('stale session is sent to /reauth with the page to return to, and nothing changes', async () => {
    age(bossCookie, REAUTH_WINDOW_MS + 1000);
    const attempts = [
      [{ action: 'set-role', userId: 'target', role: 'editor' }, '/admin/users/target', 'role'],
      [{ action: 'set-password', userId: 'target', password: strongPassword }, '/admin/users/target', 'password'],
      [{ action: 'delete', userId: 'other', confirm: 'other@example.test' }, '/admin/users/other', 'delete'],
      [{ action: 'update-profile', userId: 'target', name: 'Person target', email: 'swapped@example.test', emailVerified: 'on' }, '/admin/users/target', 'profile'],
      [{ action: 'create', name: 'New staff', email: 'new-staff@example.test', password: strongPassword, role: 'admin' }, '/admin/users/new', 'create'],
    ];
    const before = database.prepare("SELECT password FROM account WHERE userId = 'target'").get().password;
    for (const [fields, back, reason] of attempts) {
      const response = await adminPost(bossCookie, fields);
      assert.equal(response.status, 303, fields.action);
      const location = where(response);
      assert.equal(location.pathname, '/reauth');
      assert.equal(location.searchParams.get('next'), back);
      assert.equal(location.searchParams.get('reason'), reason);
    }
    assert.equal(roleOf('target'), null);
    assert.equal(database.prepare("SELECT password FROM account WHERE userId = 'target'").get().password, before);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE id IN ('other')").get().n, 1);
    assert.equal(database.prepare("SELECT email FROM user WHERE id = 'target'").get().email, 'target@example.test');
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'new-staff@example.test'").get().n, 0);
    assert.equal(sessions('target'), 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE actor_id = 'boss'").get().n, 0);
  });

  await t.test('actions that are not privileged still work on a stale session', async () => {
    const renamed = await adminPost(bossCookie, { action: 'update-profile', userId: 'target', name: 'Renamed Person', email: 'target@example.test', emailVerified: 'on' });
    assert.equal(where(renamed).searchParams.get('notice'), 'profile');
    const signedOut = await adminPost(bossCookie, { action: 'revoke-sessions', userId: 'other' });
    assert.equal(where(signedOut).searchParams.get('notice'), 'sessions');
  });

  await t.test('the add-user page asks first instead of after the form is filled in', async () => {
    const stale = await render(newUserPage, '/admin/users/new', bossCookie);
    assert.equal(stale.response.status, 302);
    assert.equal(where(stale.response).searchParams.get('next'), '/admin/users/new');
    await signIn('boss@example.test', BOSS_PASSWORD).then(async (fresh) => {
      assert.equal((await render(newUserPage, '/admin/users/new', fresh)).response.status, 200);
    });
    const anonymous = await render(reauthPage, '/reauth?next=/admin/users/target', '');
    assert.match(anonymous.response.headers.get('Location'), /^\/sign-in\?next=%2Freauth%3Fnext%3D/);
    assert.equal((await render(reauthPage, '/reauth?next=/admin/users/target', bossCookie)).response.status, 200);
  });

  await t.test('the reauth endpoint refuses wrong passwords, foreign origins, anonymous callers, and guessing', async () => {
    clearThrottles();
    const wrong = await reauthPost(bossCookie, { password: 'not-the-password-at-all', next: '/admin/users/target', reason: 'role' });
    assert.equal(wrong.status, 303);
    assert.equal(where(wrong).pathname, '/reauth');
    assert.equal(where(wrong).searchParams.get('error'), 'password');
    assert.equal(where(wrong).searchParams.get('next'), '/admin/users/target');
    assert.equal((await reauthPost(bossCookie, { password: '', next: '/admin' })).status, 303);
    assert.equal(await isFresh(sessionOf(bossCookie)), false);
    assert.equal((await reauthPost(bossCookie, { password: BOSS_PASSWORD, next: '/admin' }, { origin: 'https://other.example' })).status, 403);
    assert.equal((await reauthPost('', { password: BOSS_PASSWORD, next: '/admin' })).status, 403);
    assert.equal(await isFresh(sessionOf(bossCookie)), false);
    for (let attempt = 0; attempt < 5; attempt++) await reauthPost(bossCookie, { password: 'still-not-the-password', next: '/admin' });
    const throttled = await reauthPost(bossCookie, { password: BOSS_PASSWORD, next: '/admin' });
    assert.equal(throttled.status, 429);
    assert.equal(await isFresh(sessionOf(bossCookie)), false);
    clearThrottles();
  });

  await t.test('confirming the password returns to the action, and a hostile next goes to the account page', async () => {
    const hostile = await reauthPost(bossCookie, { password: BOSS_PASSWORD, next: 'https://evil.example/steal' });
    assert.equal(hostile.status, 303);
    assert.equal(where(hostile).origin, origin);
    assert.equal(where(hostile).pathname, '/account');
    age(bossCookie, REAUTH_WINDOW_MS + 1000);
    const ok = await reauthPost(bossCookie, { password: BOSS_PASSWORD, next: '/admin/users/target?notice=x' });
    assert.equal(where(ok).pathname + where(ok).search, '/admin/users/target?notice=x');
    assert.equal(await isFresh(sessionOf(bossCookie)), true);
  });

  await t.test('a fresh session can use every privileged action', async () => {
    const created = await adminPost(bossCookie, { action: 'create', name: 'New staff', email: 'new-staff@example.test', password: strongPassword, role: 'moderator' });
    assert.equal(where(created).searchParams.get('notice'), 'created');
    assert.equal(roleOf(where(created).pathname.split('/').at(-1)), 'moderator');
    const reset = await adminPost(bossCookie, { action: 'set-password', userId: 'target', password: strongPassword });
    assert.equal(where(reset).searchParams.get('notice'), 'password');
    assert.equal(sessions('target'), 0);
    const swapped = await adminPost(bossCookie, { action: 'update-profile', userId: 'other', name: 'Person other', email: 'swapped@example.test', emailVerified: 'on' });
    assert.equal(where(swapped).searchParams.get('notice'), 'profile');
    const removed = await adminPost(bossCookie, { action: 'delete', userId: 'other', confirm: 'swapped@example.test' });
    assert.equal(where(removed).pathname, '/admin/users');
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE id = 'other'").get().n, 0);
    // Only an administrator reaches the endpoint at all (this account's sessions were signed out above).
    assert.equal((await adminPost(otherCookie, { action: 'set-role', userId: 'target', role: 'admin' })).status, 403);
  });
});

test('staff roles that gain access end the person’s sessions', async (t) => {
  await account('chief', { role: 'admin' });
  let chiefCookie = await signIn('chief@example.test', 'chief-long-passphrase-for-tests');
  await account('reader');
  await account('bystander');
  const bystander = await signIn('bystander@example.test', 'bystander-long-passphrase-for-tests');
  const readerSignIn = () => signIn('reader@example.test', 'reader-long-passphrase-for-tests');
  const setRole = (role) => adminPost(chiefCookie, { action: 'set-role', userId: 'reader', role });

  await t.test('which moves count as gaining access', () => {
    const cases = [[null, 'moderator', true], [null, 'editor', true], [null, 'admin', true], ['moderator', 'editor', true], ['editor', 'moderator', true],
      ['editor', 'admin', true], ['moderator', 'admin', true], ['admin', 'editor', false], ['admin', 'moderator', false], ['editor', null, false],
      ['admin', null, false], ['editor', 'editor', false], [null, null, false]];
    for (const [from, to, expected] of cases) assert.equal(gainsAccess(from, to), expected, `${from} -> ${to}`);
  });

  await t.test('no role to a staff role signs them out everywhere and records it', async () => {
    const [first, second] = [await readerSignIn(), await readerSignIn()];
    assert.equal((await render(newUserPage, '/admin/users/new', first)).locals.staffRole, null);
    const response = await setRole('editor');
    assert.equal(where(response).searchParams.get('notice'), 'role');
    assert.equal(roleOf('reader'), 'editor');
    assert.equal(sessions('reader'), 0);
    for (const cookie of [first, second]) {
      // The middleware also hands every page a CSP nonce; only the signed-out state matters here.
      const { cspNonce, ...signedOut } = (await render(reauthPage, '/reauth', cookie)).locals;
      assert.deepEqual(signedOut, { user: null, session: null, staffRole: null });
    }
    assert.equal(lastAudit('reader', 'set-role').detail, 'None → Editor; signed out 2 sessions');
    assert.equal(lastAudit('reader', 'set-role').actor_id, 'chief');
    assert.equal(sessions('bystander'), 1);
    assert.equal((await render(reauthPage, '/reauth', bystander)).locals.user.id, 'bystander');
    assert.equal(sessions('chief'), 1);
  });

  await t.test('a lateral move that adds a section (editor to moderator) also signs them out', async () => {
    const cookie = await readerSignIn();
    await setRole('moderator');
    assert.equal(roleOf('reader'), 'moderator');
    assert.equal(sessions('reader'), 0);
    assert.equal((await render(reauthPage, '/reauth', cookie)).locals.user, null);
    assert.match(lastAudit('reader', 'set-role').detail, /^Editor → Moderator; signed out 1 session$/);
  });

  await t.test('losing access ends it on the next request without signing them out', async () => {
    await setRole('admin');
    const cookie = await readerSignIn();
    assert.equal((await render(reauthPage, '/reauth', cookie)).locals.staffRole, 'admin');
    await setRole('editor');
    assert.equal(sessions('reader'), 1);
    assert.equal((await render(reauthPage, '/reauth', cookie)).locals.staffRole, 'editor');
    // The old session cannot reach the admin-only endpoint with its former role.
    assert.equal((await adminPost(cookie, { action: 'set-role', userId: 'bystander', role: 'admin' })).status, 403);
    // The refusal is attributed to the signed-in account, and a repeat within the throttle window adds no second row.
    assert.equal((await adminPost(cookie, { action: 'set-role', userId: 'bystander', role: 'admin' })).status, 403);
    assert.deepEqual(database.prepare("SELECT actor_id, action, outcome, target_label, detail FROM admin_audit_log WHERE outcome = 'denied'").all().map((row) => ({ ...row })),
      [{ actor_id: 'reader', action: 'user-admin', outcome: 'denied', target_label: '/api/admin/users', detail: 'Needs a staff role this account lacks (account role: editor)' }]);
    await setRole('');
    assert.equal(roleOf('reader'), null);
    assert.equal(sessions('reader'), 1);
    assert.equal((await render(reauthPage, '/reauth', cookie)).locals.staffRole, null);
    assert.equal(lastAudit('reader', 'set-role').detail, 'Editor → None');
  });

  await t.test('an unchanged role does nothing', async () => {
    await readerSignIn();
    const open = sessions('reader');
    assert.equal(where(await setRole('')).searchParams.get('notice'), 'unchanged');
    assert.equal(sessions('reader'), open);
  });

  await t.test('stale sessions cannot elevate anyone', async () => {
    age(chiefCookie, REAUTH_WINDOW_MS + 1000);
    const open = sessions('reader');
    const response = await setRole('admin');
    assert.equal(where(response).pathname, '/reauth');
    assert.equal(roleOf('reader'), null);
    assert.equal(sessions('reader'), open);
    chiefCookie = await signIn('chief@example.test', 'chief-long-passphrase-for-tests');
  });
});

test('linking and unlinking sign-in methods need a recent confirmation', async (t) => {
  await account('linker');
  const cookie = await signIn('linker@example.test', 'linker-long-passphrase-for-tests');
  const body = { provider: 'google', callbackURL: '/account' };

  await t.test('a stale session is refused with a code the account page can act on', async () => {
    age(cookie, REAUTH_WINDOW_MS + 1000);
    for (const [path, payload] of [['link-social', body], ['unlink-account', { providerId: 'google' }]]) {
      const response = await post(path, payload, cookie);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).code, 'REAUTH_REQUIRED');
    }
  });

  await t.test('after confirming, the request gets as far as the provider setup', async () => {
    await recordReauth(sessionOf(cookie));
    const response = await post('link-social', body, cookie);
    assert.notEqual((await response.json()).code, 'REAUTH_REQUIRED');
    assert.equal((await post('link-social', body)).status, 401);
  });
});

test('password policy', async (t) => {
  const quiet = console.error;
  t.after(() => { console.error = quiet; });

  await t.test('length: 12 to 128 characters, nothing else required', async () => {
    assert.equal(MIN_PASSWORD, 12);
    assert.equal(await passwordProblem('x'.repeat(11)), 'length');
    assert.equal(await passwordProblem('Hq7!'.repeat(33)), 'length');
    assert.equal(await passwordProblem('only lowercase words here'), null);
    assert.equal(await passwordProblem('correct horse battery staple'), null);
    assert.equal(await passwordProblem('ÅngströmÅngströmÅngström'), null);
  });

  await t.test('predictable values are refused, with no composition rules', () => {
    const who = { email: 'jsmith@example.test', name: 'Jane Smith' };
    for (const weak of ['aaaaaaaaaaaaaaaaaaaa', 'abababababababab', 'abcabcabcabcabcabc', '123456789012345678', '9876543210987654', 'qwertyuiopasdfghjkl',
      'abcdefghijklmnop', 'passwordpassword1', 'Password-Password-123', 'firelandscurrent2026', 'Sandusky Sandusky 2026', 'jsmith-jsmith-1234', 'JaneSmith JaneSmith 1']) {
      assert.equal(isPredictable(weak, who), true, weak);
    }
    for (const fine of ['correct horse battery staple', 'the harbor smells like lake erie today', 'ohio-sandusky-cedar-point-ride-12!', 'kqzvbpwxjhgfdsa']) {
      assert.equal(isPredictable(fine, who), false, fine);
    }
  });

  await t.test('no password, or any part of its hash, leaves the Worker', async () => {
    const seen = [];
    const before = globalThis.fetch;
    globalThis.fetch = async (url) => { seen.push(String(url)); return before(url); };
    try { assert.equal(await passwordProblem('the harbor smells like lake erie today'), null); } finally { globalThis.fetch = before; }
    assert.deepEqual(seen, []);
  });

  await t.test('sign-up, change, and reset go through the same rules at the Better Auth boundary', async () => {
    const register = (email, password) => post('sign-up/email', { name: 'Pat Reader', email, password }, '', true);
    for (const [password, status, code] of [
      ['short-pas11', 400, 'PASSWORD_TOO_SHORT'],
      ['pat-reader-pat-reader-1', 400, 'PASSWORD_TOO_PREDICTABLE'], ['x'.repeat(129), 400, 'PASSWORD_TOO_LONG'],
    ]) {
      const response = await register('pat@example.test', password);
      assert.equal(response.status, status, password);
      assert.equal((await response.json()).code, code, password);
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'pat@example.test'").get().n, 0);
    assert.equal((await register('pat@example.test', 'a perfectly reasonable passphrase')).status, 200);

    await account('changing');
    const cookie = await signIn('changing@example.test', 'changing-long-passphrase-for-tests');
    const hash = () => database.prepare("SELECT password FROM account WHERE userId = 'changing'").get().password;
    const before = hash();
    const weak = await post('change-password', { currentPassword: 'changing-long-passphrase-for-tests', newPassword: 'qwertyuiopasdfghjkl' }, cookie);
    assert.equal((await weak.json()).code, 'PASSWORD_TOO_PREDICTABLE');
    const mine = await post('change-password', { currentPassword: 'changing-long-passphrase-for-tests', newPassword: 'Person changing changing' }, cookie);
    assert.equal((await mine.json()).code, 'PASSWORD_TOO_PREDICTABLE');
    assert.equal(hash(), before);

    const asked = await post('request-password-reset', { email: 'changing@example.test', redirectTo: '/reset-password' }, '', true);
    assert.equal(asked.status, 200);
    const token = new URL(mail.at(-1).url).pathname.split('/').at(-1);
    const refused = await post('reset-password', { token, newPassword: 'passwordpassword12345' });
    assert.equal((await refused.json()).code, 'PASSWORD_TOO_PREDICTABLE');
    assert.equal(hash(), before);
    assert.equal((await post('reset-password', { token, newPassword: 'a fresh and unusual passphrase' })).status, 200);
    assert.notEqual(hash(), before);
  });

  await t.test('existing shorter passwords keep working: signing in is never re-checked', async () => {
    await account('veteran', { password: 'short-p1' });
    assert.equal((await post('sign-in/email', { email: 'veteran@example.test', password: 'short-p1' })).status, 200);
  });

  await t.test('admin-created and admin-set passwords follow the same rules', async () => {
    await account('admin-two', { role: 'admin' });
    await account('subject');
    const cookie = await signIn('admin-two@example.test', 'admin-two-long-passphrase-for-tests');
    const before = database.prepare("SELECT password FROM account WHERE userId = 'subject'").get().password;
    const attempts = [
      ['short-pas11', 'password'], ['passwordpassword12345', 'password-predictable'],
    ];
    for (const [password, error] of attempts) {
      const reset = await adminPost(cookie, { action: 'set-password', userId: 'subject', password });
      assert.equal(where(reset).pathname, '/admin/users/subject');
      assert.equal(where(reset).searchParams.get('error'), error, password);
      const created = await adminPost(cookie, { action: 'create', name: 'Someone New', email: 'someone-new@example.test', password, role: '' });
      assert.equal(where(created).pathname, '/admin/users/new');
      assert.equal(where(created).searchParams.get('error'), error, password);
    }
    assert.equal(database.prepare("SELECT password FROM account WHERE userId = 'subject'").get().password, before);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'someone-new@example.test'").get().n, 0);
  });
});
