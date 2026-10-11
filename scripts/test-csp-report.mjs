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
const reportModule = sourceModule('src/lib/csp-report.ts');
const { createLogLimiter, violations } = await import(reportModule);
const { POST } = await import(sourceModule('src/pages/api/csp-report.ts', {
  '../../lib/csp-report': reportModule,
  '../../lib/request-body': sourceModule('src/lib/request-body.ts'),
}));

const site = 'https://firelandscurrent.com';
const legacy = (report) => ({ 'csp-report': report });
const batch = (...bodies) => bodies.map((body) => ({ type: 'csp-violation', age: 1, url: `${site}/news/story?utm=x`, user_agent: 'Fixture/1.0', body }));

/** Runs the endpoint and returns its status and the log lines it wrote. */
async function post(body, { type = 'application/csp-report', origin, path = '/api/csp-report' } = {}) {
  const headers = { 'Content-Type': type };
  if (origin) headers.Origin = origin;
  const lines = [];
  const warn = console.warn;
  console.warn = (line) => lines.push(JSON.parse(line));
  try {
    const response = await POST({ request: new Request(`${site}${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return { status: response.status, lines };
  } finally {
    console.warn = warn;
  }
}

test('report-uri deliveries keep only the directive, blocked origin, page path, and disposition', () => {
  const [violation] = violations(legacy({
    'document-uri': `${site}/reset-password?token=secret#x`,
    referrer: 'https://referrer.example/private?q=1',
    'violated-directive': "script-src-elem 'nonce-abc'",
    'effective-directive': 'script-src-elem',
    'original-policy': "script-src 'nonce-abc'",
    disposition: 'report',
    'blocked-uri': 'https://static.cloudflareinsights.com/beacon.min.js/v123?token=abc',
    'source-file': 'https://firelandscurrent.com/_astro/x.js',
    'script-sample': 'reader@example.com',
    'line-number': 3,
  }), site);
  assert.deepEqual(violation, { directive: 'script-src-elem', blocked: 'https://static.cloudflareinsights.com', page: '/reset-password', disposition: 'report' });
});

test('Reporting API batches are read, and other report types are ignored', () => {
  const found = violations([
    ...batch({ documentURL: `${site}/talk?type=story`, effectiveDirective: 'style-src-elem', blockedURL: 'inline', disposition: 'enforce', sample: '.secret{}' }),
    { type: 'deprecation', body: { id: 'x' } },
    { type: 'csp-violation', body: 'not an object' },
  ], site);
  assert.deepEqual(found, [{ directive: 'style-src-elem', blocked: 'inline', page: '/talk', disposition: 'enforce' }]);
});

test('URLs are reduced to an origin or scheme, and other sites\' pages are not named', () => {
  const one = (blockedURL, documentURL = `${site}/`) => violations(batch({ effectiveDirective: 'img-src', blockedURL, documentURL, disposition: 'report' }), site)[0];
  assert.equal(one('data:image/png;base64,AAAA').blocked, 'data:');
  assert.equal(one('blob:https://firelandscurrent.com/1234').blocked, 'blob:');
  assert.equal(one('chrome-extension://abc/script.js').blocked, 'chrome-extension:');
  assert.equal(one('eval').blocked, 'eval');
  assert.equal(one('not a url').blocked, 'other');
  assert.equal(one(42).blocked, 'unknown');
  assert.equal(one('https://a.example/', 'https://copy.example/news/story').page, 'other-origin');
  assert.equal(one('https://a.example/', `${site}/${'a'.repeat(500)}`).page.length, 200);
  assert.equal(violations(batch({ effectiveDirective: 'script-src<script>', disposition: 'other' }), site)[0].directive, 'unknown');
  assert.equal(violations(batch({ effectiveDirective: 'img-src', disposition: 'other' }), site)[0].disposition, 'unknown');
});

test('a delivery yields at most 20 violations, and unrecognized payloads none', () => {
  const many = batch(...Array.from({ length: 50 }, (_, i) => ({ effectiveDirective: 'img-src', blockedURL: `https://h${i}.example/`, documentURL: `${site}/` })));
  assert.equal(violations(many, site).length, 20);
  for (const payload of [null, 1, 'x', {}, { 'csp-report': 'x' }, [1, 2]]) assert.deepEqual(violations(payload, site), []);
});

test('the log limiter repeats a violation only after its window, and caps lines per minute', () => {
  const limit = createLogLimiter({ repeatMs: 1000, perMinute: 3 });
  const v = (blocked) => ({ directive: 'img-src', blocked, page: '/', disposition: 'report' });
  assert.equal(limit(v('a'), 0), true);
  assert.equal(limit(v('a'), 500), false);
  assert.equal(limit(v('a'), 1500), true);
  assert.equal(limit(v('b'), 1600), true);
  assert.equal(limit(v('c'), 1700), false, 'fourth line in the minute');
  assert.equal(limit(v('c'), 61_000), true, 'next minute');
});

test('the endpoint logs a redacted line, stores nothing, and answers 204', async () => {
  const { status, lines } = await post(legacy({ 'document-uri': `${site}/contact?name=Pat`, 'effective-directive': 'img-src', 'blocked-uri': 'https://tracker.example/p.gif?email=pat@example.com', disposition: 'report', 'script-sample': 'pat@example.com' }), { origin: site });
  assert.equal(status, 204);
  assert.deepEqual(lines, [{ event: 'csp_violation', directive: 'img-src', blocked: 'https://tracker.example', page: '/contact', disposition: 'report' }]);
  assert.doesNotMatch(JSON.stringify(lines), /pat|Pat|email|p\.gif/);
});

test('Reporting API deliveries, with or without an opaque origin, are accepted', async () => {
  const body = batch({ documentURL: `${site}/events`, effectiveDirective: 'connect-src', blockedURL: 'https://api.example/x', disposition: 'report' });
  assert.equal((await post(body, { type: 'application/reports+json' })).status, 204);
  assert.equal((await post(body, { type: 'application/reports+json', origin: 'null' })).status, 204);
});

test('foreign origins, other content types, oversized and malformed bodies are refused', async () => {
  const body = legacy({ 'effective-directive': 'img-src', 'blocked-uri': 'https://x.example/' });
  assert.equal((await post(body, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post(body, { type: 'text/plain' })).status, 415);
  assert.equal((await post(body, { type: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post('x'.repeat(40 * 1024))).status, 413);
  assert.equal((await post('{not json')).status, 400);
  const empty = await post({ unrelated: true });
  assert.deepEqual([empty.status, empty.lines], [204, []]);
});
