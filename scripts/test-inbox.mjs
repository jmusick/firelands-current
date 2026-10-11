import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function sourceModule(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from ${JSON.stringify(replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const emails = [];
const stored = [];
let failSend = false;
let captchaValid = true;
const realFetch = globalThis.fetch;
globalThis.__inboxEnv = {
  TURNSTILE_SECRET_KEY: 'fixture-secret',
  EMAIL: { async send(message) {
    if (failSend) throw new Error('Simulated provider failure');
    emails.push(message);
    return { messageId: 'fixture-message' };
  } },
  DB: { prepare() { return { bind(...values) { return { async run() { stored.push(values); } }; } }; } },
};
// Replaced per test to simulate Cloudflare's siteverify answers; null answers with the normal pass/fail result.
let siteverify = null;
let verifyCalls = 0;
globalThis.fetch = async (url, options) => {
  verifyCalls++;
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(options.body.get('secret'), 'fixture-secret');
  assert.equal(options.body.get('response'), 'fixture-token');
  assert.ok(options.signal instanceof AbortSignal, 'the bot check must be bounded by an abort signal');
  return siteverify ? siteverify(options) : Response.json({ success: captchaValid });
};
const stubEnv = 'data:text/javascript,export const env = globalThis.__inboxEnv;';
const forumModule = sourceModule('src/lib/forum.ts', { 'cloudflare:workers': stubEnv });
const bodyModule = sourceModule('src/lib/request-body.ts');
const formErrorsModule = sourceModule('src/lib/form-errors.ts');
const inboxModule = sourceModule('src/lib/inbox.ts', { 'cloudflare:workers': stubEnv });
// Quota counting has its own tests (test-quotas.mjs); these fixtures only model the form flow.
const quotasStub = 'data:text/javascript,export const takeQuota = async () => null; export const quotaResponse = () => new Response(null, { status: 429 });';
const { POST } = await import(sourceModule('src/pages/api/inbox.ts', {
  'cloudflare:workers': stubEnv, '../../lib/forum': forumModule, '../../lib/request-body': bodyModule, '../../lib/inbox': inboxModule, '../../lib/quotas': quotasStub,
  '../../lib/form-errors': formErrorsModule,
}));
const newsModule = sourceModule('src/lib/news.ts', { 'cloudflare:workers': stubEnv });
const mediaModule = sourceModule('src/lib/media.ts', { 'cloudflare:workers': stubEnv, './forum': forumModule });
const trackingModule = sourceModule('src/lib/ad-tracking.ts', { 'cloudflare:workers': stubEnv });
const { pageTakesAds } = await import(sourceModule('src/lib/ads.ts', {
  'cloudflare:workers': stubEnv, './ad-tracking': trackingModule, './media': mediaModule, './news': newsModule,
}));

const values = { kind: 'ads', name: 'Local Business', email: 'advertiser@example.com',
  subject: 'Autumn campaign', body: 'We would like to advertise our upcoming local event.',
  'cf-turnstile-response': 'fixture-token' };
function call(overrides = {}, origin = 'https://firelandscurrent.com') {
  const headers = origin === null ? {} : { Origin: origin };
  const request = new Request('https://firelandscurrent.com/api/inbox', {
    method: 'POST', headers, body: new URLSearchParams({ ...values, ...overrides }),
  });
  return POST({ request, locals: { user: null } });
}
test.beforeEach(() => {
  emails.length = 0; stored.length = 0; failSend = false; captchaValid = true; siteverify = null; verifyCalls = 0;
  delete globalThis.__inboxEnv.TURNSTILE_EXPECTED_HOSTNAMES;
});
test.after(() => { globalThis.fetch = realFetch; delete globalThis.__inboxEnv; });

test('signed-out advertising inquiries email the fixed ads inbox with Reply-To and no database write', async () => {
  const response = await call();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), 'https://firelandscurrent.com/advertise?sent=1');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'ads@firelandscurrent.com');
  assert.equal(emails[0].from.email, 'noreply@firelandscurrent.com');
  assert.deepEqual(emails[0].replyTo, { email: values.email, name: values.name });
  assert.equal(emails[0].subject, 'Advertising inquiry: Autumn campaign');
  assert.ok(emails[0].text.includes(values.body));
  assert.equal(stored.length, 0);
});

test('cross-origin, missing origin, and unknown inbox kinds cannot send', async () => {
  assert.equal((await call({}, 'https://attacker.invalid')).status, 403);
  assert.equal((await call({}, null)).status, 403);
  assert.equal((await call({ kind: 'other@example.com' })).status, 400);
  assert.equal(emails.length, 0);
});

test('honeypots, failed human checks, and invalid fields cannot send', async () => {
  assert.match((await call({ website: 'spam' })).headers.get('Location'), /sent=1$/);
  captchaValid = false;
  assert.match((await call()).headers.get('Location'), /error=captcha$/);
  captchaValid = true;
  // The redirect names the invalid fields but never repeats what was typed.
  for (const [invalid, field] of [[{ name: '' }, 'name'], [{ email: 'bad' }, 'email'], [{ email: 'a@example.com\r\nBcc: other@example.com' }, 'email'],
    [{ subject: 'Hi' }, 'subject'], [{ body: 'Short' }, 'body'], [{ body: 'a'.repeat(10001) }, 'body']]) {
    assert.equal((await call(invalid)).headers.get('Location'), `https://firelandscurrent.com/advertise?error=invalid&fields=${field}`);
  }
  assert.equal((await call({ name: '', email: 'bad', subject: 'Hi', body: 'Short' })).headers.get('Location'),
    'https://firelandscurrent.com/advertise?error=invalid&fields=name,email,subject,body');
  assert.equal(emails.length, 0);
  assert.equal(stored.length, 0);
});

const hangUntilAborted = (options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener('abort', () => reject(options.signal.reason));
});
const unavailableCases = {
  'a timeout abort': () => () => { throw new DOMException('The operation timed out.', 'TimeoutError'); },
  'a network error': () => () => { throw new TypeError('fetch failed'); },
  'an HTTP failure': () => () => new Response('Bad gateway', { status: 502 }),
  'a non-JSON body': () => () => new Response('<html>Service unavailable</html>', { status: 200 }),
  'a null JSON body': () => () => Response.json(null),
  'a Cloudflare internal error': () => () => Response.json({ success: false, 'error-codes': ['internal-error'] }),
  'a rejected secret': () => () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }),
};

test('an unreachable or broken bot check fails closed with a retry message and sends or stores nothing', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [name, make] of Object.entries(unavailableCases)) {
      siteverify = make();
      for (const kind of ['ads', 'news']) {
        const response = await call({ kind });
        assert.equal(response.status, 303, name);
        assert.match(response.headers.get('Location'), /\?error=captcha_unavailable$/, name);
      }
    }
  } finally { console.error = originalError; }
  assert.equal(emails.length, 0);
  assert.equal(stored.length, 0);
});

test('verifyTurnstile times out a stalled siteverify request instead of waiting indefinitely', async () => {
  const { verifyTurnstile } = await import(inboxModule);
  const originalError = console.error;
  console.error = () => {};
  siteverify = hangUntilAborted;
  try {
    const started = Date.now();
    assert.equal(await verifyTurnstile('fixture-token', null, 'inbox', { timeoutMs: 25 }), 'unavailable');
    assert.ok(Date.now() - started < 2000);
  } finally { console.error = originalError; }
});

test('rejected tokens are a failed check, not an outage, and missing or oversized tokens never reach Cloudflare', async () => {
  const { verifyTurnstile } = await import(inboxModule);
  siteverify = () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
  assert.equal(await verifyTurnstile('fixture-token', '203.0.113.5', 'inbox'), 'rejected');
  assert.match((await call()).headers.get('Location'), /error=captcha$/);
  verifyCalls = 0;
  assert.equal(await verifyTurnstile('', null), 'rejected');
  assert.equal(await verifyTurnstile('x'.repeat(2049), null), 'rejected');
  assert.equal(verifyCalls, 0);
  assert.equal(emails.length, 0);
  assert.equal(stored.length, 0);
});

test('when expected hostnames are configured, the hostname and action must match', async () => {
  globalThis.__inboxEnv.TURNSTILE_EXPECTED_HOSTNAMES = 'firelandscurrent.com, www.firelandscurrent.com';
  const originalError = console.error;
  console.error = () => {};
  try {
    const answer = (extra) => () => Response.json({ success: true, hostname: 'firelandscurrent.com', action: 'inbox', ...extra });
    siteverify = answer({});
    assert.match((await call()).headers.get('Location'), /sent=1$/);
    siteverify = answer({ hostname: 'WWW.firelandscurrent.com' });
    assert.match((await call()).headers.get('Location'), /sent=1$/);
    assert.equal(emails.length, 2);
    for (const wrong of [{ hostname: 'attacker.invalid' }, { hostname: undefined }, { action: 'corrections' }, { action: undefined }]) {
      siteverify = answer(wrong);
      assert.match((await call()).headers.get('Location'), /error=captcha$/);
    }
    assert.equal(emails.length, 2);
  } finally { console.error = originalError; }
});

test('advertising and contact send failures report an error; stored news tips stay accepted', async () => {
  failSend = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [kind, path] of [['ads', '/advertise'], ['contact', '/contact']]) {
      const response = await call({ kind });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('Location'), `https://firelandscurrent.com${path}?error=send`);
    }
    assert.equal(stored.length, 0);
    assert.match((await call({ kind: 'news' })).headers.get('Location'), /submit-news\?sent=1$/);
    assert.equal(stored.length, 1);
  } finally { console.error = originalError; }
});

test('visitor HTML is escaped in the email and subject line breaks are removed', async () => {
  await call({ name: '<img src=x onerror=alert(1)>', body: '<script>alert("inquiry")</script>', subject: 'Campaign\r\nInjected' });
  assert.doesNotMatch(emails[0].html, /<img|<script/);
  assert.match(emails[0].html, /&lt;script&gt;/);
  assert.equal(emails[0].subject, 'Advertising inquiry: Campaign Injected');
});

test('the advertise form page does not display ads while news pages still can', () => {
  assert.equal(pageTakesAds('/advertise'), false);
  assert.equal(pageTakesAds('/advertise/'), false);
  assert.equal(pageTakesAds('/news/local/story'), true);
});

// Tip review state: viewing never changes it; the explicit POST is guarded, audited and repeat-safe.
const auditModule = sourceModule('src/lib/audit.ts', { 'cloudflare:workers': stubEnv });
const { POST: reviewPost } = await import(sourceModule('src/pages/api/admin/submissions.ts', {
  'cloudflare:workers': stubEnv, '../../../lib/audit': auditModule, '../../../lib/forum': forumModule, '../../../lib/request-body': bodyModule,
  '../../../lib/admin': 'data:text/javascript,export const ADMIN={submissions:"s"};export const canAccess=(role)=>role==="editor"||role==="admin";',
}));
const tipId = 'tip-12345678';
function tipDb(initial) {
  const state = { status: initial, audit: [], denied: [] };
  const statement = () => ({ bind: (...v) => ({ v, async first() { return { status: state.status }; }, async run() { state.denied.push(v); } }) });
  return { state, DB: {
    prepare: statement,
    // Mirrors the SQL guard: both statements only apply while the tip is in an allowed status.
    async batch([audit, update]) {
      if (update.v.slice(3).includes(state.status)) { state.audit.push(audit.v); state.status = update.v[0]; }
    },
  } };
}
function reviewCall(overrides = {}, { origin = 'https://firelandscurrent.com', role = 'editor', user = { id: 'u1', name: 'Editor' } } = {}) {
  const request = new Request('https://firelandscurrent.com/api/admin/submissions', {
    method: 'POST', headers: origin ? { Origin: origin } : {}, body: new URLSearchParams({ id: tipId, status: 'reviewed', ...overrides }),
  });
  return reviewPost({ request, locals: { user, staffRole: role } });
}
async function withTip(initial, fn) {
  const original = globalThis.__inboxEnv.DB;
  const fake = tipDb(initial);
  globalThis.__inboxEnv.DB = fake.DB;
  try { await fn(fake.state); } finally { globalThis.__inboxEnv.DB = original; }
}

test('marking an unread tip reviewed is audited without tip content', () => withTip('unread', async (state) => {
  const response = await reviewCall();
  assert.equal(response.status, 303);
  assert.equal(state.status, 'reviewed');
  assert.equal(state.audit.length, 1);
  // Actor, then the record kind and action: the entry names the tip by id and carries no tip text or contact details.
  assert.deepEqual(state.audit[0].slice(1, 5), ['u1', 'Editor', 'tip', 'tip-reviewed']);
  assert.equal(state.audit[0][5], 'unread → reviewed');
  assert.ok(state.audit[0].includes(tipId));
}));

test('marking an already reviewed tip again is a no-op without a duplicate audit entry', () => withTip('reviewed', async (state) => {
  const response = await reviewCall();
  assert.equal(response.status, 303);
  assert.equal(state.status, 'reviewed');
  assert.equal(state.audit.length, 0);
}));

test('review actions reject outsiders, cross-origin posts and bad input', () => withTip('unread', async (state) => {
  assert.equal((await reviewCall({}, { role: 'member' })).status, 403);
  assert.equal((await reviewCall({}, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await reviewCall({}, { user: null })).status, 303);
  // A signed-in account's refused attempts are recorded as denied; the signed-out one has no actor to record.
  assert.deepEqual(state.denied.map((v) => [v[1], v[4], v[5]]), [
    ['u1', 'tip-review', 'Needs a staff role this account lacks (account role: member)'],
    ['u1', 'tip-review', 'Cross-origin request refused'],
  ]);
  assert.equal((await reviewCall({ status: 'unread' })).status, 400);
  assert.equal((await reviewCall({ id: 'x' })).status, 400);
  assert.equal(state.status, 'unread');
  assert.equal(state.audit.length, 0);
}));

test('converted tips cannot be changed', () => withTip('converted', async (state) => {
  assert.equal((await reviewCall()).status, 404);
  assert.equal(state.status, 'converted');
}));

test('the tip detail page does not write on GET', () => {
  const page = readFileSync(new URL('../src/pages/admin/submissions/[id].astro', import.meta.url), 'utf8');
  assert.ok(!/UPDATE news_submissions/.test(page));
});

test('invalid field names from a redirect are limited to the form\'s own fields', async () => {
  const { INBOX_FIELD_ERRORS, parseInvalidFields } = await import(formErrorsModule);
  assert.deepEqual(parseInvalidFields('email,name', INBOX_FIELD_ERRORS), ['name', 'email']);
  assert.deepEqual(parseInvalidFields('body,<script>,__proto__,constructor', INBOX_FIELD_ERRORS), ['body']);
  assert.deepEqual(parseInvalidFields(null, INBOX_FIELD_ERRORS), []);
});
