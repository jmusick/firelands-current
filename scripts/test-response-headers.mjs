import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/lib/response-headers.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText;
const { applyCachePolicy, applyContentSecurityPolicy, applySecurityHeaders, contentSecurityPolicy, createNonce, CSP_ENFORCE, isBundledScript, isHtml, isPrivatePath, PRIVATE_CACHE_CONTROL } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const html = 'text/html; charset=utf-8';
/** The Cache-Control a response ends up with after the policy runs. */
function policy(pathname, { signedIn = false, type = html, cache, cookie } = {}) {
  const headers = new Headers({ 'Content-Type': type });
  if (cache) headers.set('Cache-Control', cache);
  if (cookie) headers.append('Set-Cookie', cookie);
  applyCachePolicy(headers, { pathname, signedIn });
  return headers.get('Cache-Control');
}

test('private paths match whole segments only', () => {
  for (const path of ['/account', '/admin', '/admin/news/abc', '/business/1/ads/2', '/api/talk/votes', '/api/auth/get-session', '/sign-in', '/reset-password'])
    assert.equal(isPrivatePath(path), true, path);
  for (const path of ['/', '/news/business-roundup', '/accounting', '/apiary', '/administrator-notes', '/profile/u1', '/media/a.jpg'])
    assert.equal(isPrivatePath(path), false, path);
});

test('account, admin, business, auth, and API responses are private even when anonymous', () => {
  for (const path of ['/account', '/admin/users', '/business', '/api/auth/sign-in/email', '/api/inbox', '/reset-password'])
    assert.equal(policy(path), PRIVATE_CACHE_CONTROL, path);
  assert.equal(policy('/api/talk/votes', { type: 'text/plain' }), PRIVATE_CACHE_CONTROL);
});

test('an unsafe explicit header on a private response is replaced; an explicit no-store is kept', () => {
  assert.equal(policy('/admin', { cache: 'public, max-age=300' }), PRIVATE_CACHE_CONTROL);
  assert.equal(policy('/api/admin/news/preview', { cache: 'no-store' }), 'no-store');
  assert.equal(policy('/api/x', { cache: 'no-cache, no-store, must-revalidate' }), 'no-cache, no-store, must-revalidate');
  assert.equal(policy('/api/x', { cache: 'no-store-ish' }), PRIVATE_CACHE_CONTROL);
});

test('a response that sets a cookie is private, whatever the route chose', () => {
  assert.equal(policy('/', { cookie: 'session=abc; Path=/; HttpOnly' }), PRIVATE_CACHE_CONTROL);
  assert.equal(policy('/media/a.jpg', { type: 'image/jpeg', cache: 'public, max-age=31536000, immutable', cookie: 'session=abc' }), PRIVATE_CACHE_CONTROL);
});

test('HTML for a signed-in reader is private, even if the page asked for public caching', () => {
  assert.equal(policy('/', { signedIn: true }), PRIVATE_CACHE_CONTROL);
  assert.equal(policy('/news/story', { signedIn: true, cache: 'public, max-age=60' }), PRIVATE_CACHE_CONTROL);
  assert.equal(policy('/news/story', { signedIn: true, type: 'text/plain' }), PRIVATE_CACHE_CONTROL);
});

test('media, feeds, and other non-HTML keep their own caching for signed-in readers', () => {
  assert.equal(policy('/media/a.jpg', { signedIn: true, type: 'image/jpeg', cache: 'public, max-age=31536000, immutable' }), 'public, max-age=31536000, immutable');
  assert.equal(policy('/rss.xml', { signedIn: true, type: 'application/rss+xml', cache: 'public, max-age=300' }), 'public, max-age=300');
});

test('anonymous public responses are left as the route set them', () => {
  assert.equal(policy('/'), null);
  assert.equal(policy('/news/story'), null);
  assert.equal(policy('/sitemap.xml', { type: 'application/xml', cache: 'public, max-age=3600' }), 'public, max-age=3600');
});

test('security headers are set on every response', () => {
  const headers = new Headers();
  applySecurityHeaders(headers);
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Strict-Transport-Security'), 'max-age=31536000');
});

/** The policy as a map of directive name to its source list. */
const directives = (policy) => new Map(policy.split('; ').map((part) => { const [name, ...sources] = part.split(' '); return [name, sources]; }));

test('nonces are fresh 128-bit base64 values', () => {
  const nonces = new Set(Array.from({ length: 50 }, createNonce));
  assert.equal(nonces.size, 50);
  for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
});

test('scripts run only with the nonce, with no host allowlist or unsafe allowances', () => {
  const policy = directives(contentSecurityPolicy('abc123'));
  assert.deepEqual(policy.get('script-src'), ["'nonce-abc123'", "'strict-dynamic'"]);
  assert.equal(policy.has('script-src-elem'), false);
  assert.equal(policy.has('script-src-attr'), false);
  for (const [name, sources] of policy) {
    assert.ok(!sources.includes("'unsafe-eval'"), name);
    if (name !== 'style-src-attr') assert.ok(!sources.includes("'unsafe-inline'"), name);
  }
});

test('the policy restricts plugins, base URLs, form targets, and framing, and names its report endpoint', () => {
  const policy = directives(contentSecurityPolicy('n'));
  assert.deepEqual(policy.get('default-src'), ["'self'"]);
  assert.deepEqual(policy.get('object-src'), ["'none'"]);
  assert.deepEqual(policy.get('base-uri'), ["'none'"]);
  assert.deepEqual(policy.get('form-action'), ["'self'"]);
  assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(policy.get('frame-src'), ['https://challenges.cloudflare.com']);
  assert.deepEqual(policy.get('style-src'), ["'self'", 'https://fonts.googleapis.com']);
  assert.deepEqual(policy.get('style-src-attr'), ["'unsafe-inline'"]);
  assert.deepEqual(policy.get('font-src'), ["'self'", 'https://fonts.gstatic.com']);
  assert.ok(policy.get('img-src').includes('blob:'));
  assert.ok(policy.get('connect-src').includes('https://*.google-analytics.com'));
  assert.deepEqual(policy.get('report-uri'), ['/api/csp-report']);
  assert.deepEqual(policy.get('report-to'), ['csp']);
});

test('development adds only what Vite needs: inline component styles and the HMR socket', () => {
  const prod = directives(contentSecurityPolicy('n'));
  const dev = directives(contentSecurityPolicy('n', { dev: true }));
  assert.deepEqual(dev.get('style-src'), [...prod.get('style-src'), "'unsafe-inline'"]);
  assert.deepEqual(dev.get('connect-src'), [...prod.get('connect-src'), 'ws:']);
  assert.deepEqual(dev.get('script-src'), prod.get('script-src'));
});

test('the policy goes in the report-only header unless CSP_ENFORCE is set, with the reporting endpoint', () => {
  const headers = new Headers();
  applyContentSecurityPolicy(headers, 'n', { origin: 'https://firelandscurrent.com' });
  const [used, unused] = CSP_ENFORCE ? ['Content-Security-Policy', 'Content-Security-Policy-Report-Only'] : ['Content-Security-Policy-Report-Only', 'Content-Security-Policy'];
  assert.equal(headers.get(used), contentSecurityPolicy('n'));
  assert.equal(headers.get(unused), null);
  assert.equal(headers.get('Reporting-Endpoints'), 'csp="https://firelandscurrent.com/api/csp-report"');
  const dev = new Headers();
  applyContentSecurityPolicy(dev, 'n', { origin: 'http://localhost:4321', dev: true });
  assert.equal(dev.get(used), contentSecurityPolicy('n', { dev: true }));
  assert.equal(dev.get('Reporting-Endpoints'), 'csp="http://localhost:4321/api/csp-report"');
});

test('only Astro bundles get the nonce from the middleware', () => {
  for (const src of ['/_astro/BaseLayout.astro_astro_type_script_index_0_lang.Bx1_x-9a.js', '/_astro/page.CjVt3.js'])
    assert.equal(isBundledScript(src), true, src);
  for (const src of [null, '', '/_astro/../media/a.js', '/_astro/sub/a.js', '/_astro/a.js?x', '/media/a.js', '//evil.example/_astro/a.js', 'https://evil.example/_astro/a.js', '/_astro/a.css', 'data:text/javascript,1'])
    assert.equal(isBundledScript(src), false, String(src));
  assert.equal(isBundledScript('/@vite/client', { dev: true }), true);
  assert.equal(isBundledScript('/src/components/Turnstile.astro?astro&type=script&index=0&lang.ts', { dev: true }), true);
  assert.equal(isBundledScript('//evil.example/a.js', { dev: true }), false);
  assert.equal(isBundledScript('https://evil.example/a.js', { dev: true }), false);
});

test('HTML is recognized by its content type', () => {
  assert.equal(isHtml(new Headers({ 'Content-Type': 'text/html; charset=utf-8' })), true);
  assert.equal(isHtml(new Headers({ 'Content-Type': 'application/json' })), false);
  assert.equal(isHtml(new Headers()), false);
});
