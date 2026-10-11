// Automated accessibility checks (issue #26): axe-core on representative pages, forced-colors and
// reduced-motion rendering, and a keyboard tab-order smoke test. This is a dev tool against a server you
// started yourself; it is not part of `npm run build` or the other test:* scripts.
//
//   npm run dev -- --port 4399     (or: npx astro dev --host 127.0.0.1 --port 4399)
//   npm run test:a11y
//
// A11Y_BASE_URL picks the server (default http://127.0.0.1:4399; loopback addresses only). Signed-in pages
// use throwaway users, sessions, and a business that this script writes to the LOCAL D1 database
// (`wrangler d1 execute --local`) and deletes again when it finishes. Browser requests to other origins and
// to the ad-statistics beacons are blocked, so a run neither contacts third parties nor records ad counts.
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = new URL(process.env.A11Y_BASE_URL ?? 'http://127.0.0.1:4399');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(BASE.hostname)) {
  console.error(`Refusing to run against ${BASE.origin}: this script writes test users to the local database, so it only targets a local server.`);
  process.exit(2);
}

// WCAG 2.0, 2.1 and 2.2 levels A and AA.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TEST_EMAIL_DOMAIN = 'a11y.invalid';
const TEST_PREFIX = 'a11y-axe-';

// ---------------------------------------------------------------- local database

const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function d1(sql) {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'DB', '--local', '--json', '--command', sql], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out).flatMap((r) => r.results ?? []);
}

function d1File(statements) {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-'));
  const file = join(dir, 'setup.sql');
  try {
    writeFileSync(file, statements.join(';\n') + ';\n');
    execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'DB', '--local', '--file', file], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

function authSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = join(ROOT, '.dev.vars');
  if (existsSync(file)) {
    const match = readFileSync(file, 'utf8').match(/^BETTER_AUTH_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error('Set BETTER_AUTH_SECRET or create .dev.vars (see README.md, Local setup).');
}

/** The value of Better Auth's signed session cookie: token.signature, URL-encoded. */
function sessionCookie(token, secret) {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

function cleanup() {
  d1File([
    // Cascades remove sessions, reauth rows, staff roles, memberships, and anything else keyed to the users.
    `DELETE FROM "user" WHERE email LIKE ${q(`${TEST_PREFIX}%@${TEST_EMAIL_DOMAIN}`)}`,
    `DELETE FROM businesses WHERE id LIKE ${q(`${TEST_PREFIX}%`)}`,
  ]);
}

/** Creates one user per role with a live session; returns cookie values by role. */
function createTestSessions() {
  const secret = authSecret();
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const expires = new Date(now + 60 * 60 * 1000).toISOString();
  const run = randomBytes(4).toString('hex');
  const businessId = `${TEST_PREFIX}biz-${run}`;
  const people = [
    { role: 'reader', name: 'Axe Reader' },
    { role: 'business', name: 'Axe Business Owner' },
    { role: 'admin', name: 'Axe Administrator', staff: 'admin' },
  ];
  const statements = [
    `INSERT INTO businesses (id, name, kind, status, created_at, updated_at) VALUES (${q(businessId)}, ${q(`Axe Test Business ${run}`)}, 'advertiser', 'active', ${now}, ${now})`,
  ];
  const cookies = {};
  const ids = {};
  for (const person of people) {
    const id = `${TEST_PREFIX}${person.role}-${run}`;
    const token = randomBytes(24).toString('hex');
    const sessionId = `${TEST_PREFIX}s-${person.role}-${run}`;
    ids[person.role] = id;
    cookies[person.role] = sessionCookie(token, secret);
    statements.push(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (${q(id)}, ${q(person.name)}, ${q(`${id}@${TEST_EMAIL_DOMAIN}`)}, 1, ${q(iso)}, ${q(iso)})`,
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (${q(sessionId)}, ${q(expires)}, ${q(token)}, ${q(iso)}, ${q(iso)}, ${q(id)})`,
      `INSERT INTO session_reauth (session_id, reauthenticated_at) VALUES (${q(sessionId)}, ${now})`,
    );
    if (person.staff) statements.push(`INSERT INTO staff_roles (user_id, role, created_at) VALUES (${q(id)}, ${q(person.staff)}, ${now})`);
    if (person.role === 'business') statements.push(`INSERT INTO business_members (business_id, user_id, role, created_at) VALUES (${q(businessId)}, ${q(id)}, 'owner', ${now})`);
  }
  d1File(statements);
  return { cookies, ids, businessId };
}

// ---------------------------------------------------------------- page list

function firstRow(sql) {
  return d1(sql)[0];
}

function pagesToScan({ ids, businessId }) {
  const story = firstRow("SELECT slug, id FROM news_articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 1");
  const event = firstRow("SELECT slug FROM events WHERE status = 'published' LIMIT 1");
  const discussion = firstRow('SELECT id FROM forum_threads LIMIT 1');
  const anyArticle = firstRow('SELECT id FROM news_articles ORDER BY updated_at DESC LIMIT 1');
  const anyEvent = firstRow('SELECT id FROM events ORDER BY updated_at DESC LIMIT 1');

  const pages = [
    ['public', '/'],
    ['public', '/news'],
    ['public', '/news?section=government'],
    ['public', '/events'],
    ['public', '/links'],
    ['public', '/talk'],
    ['public', '/about'],
    ['public', '/accessibility'],
    ['public', '/privacy'],
    ['public', '/terms'],
    ['public', '/contact'],
    ['public', '/submit-news'],
    ['public', '/advertise'],
    ['public', '/sign-in'],
    ['public', '/register'],
    ['public', '/forgot-password'],
  ];
  if (story) pages.push(['public', `/news/${story.slug}`], ['public', `/report-inaccuracy?type=news&slug=${story.slug}`]);
  if (event) pages.push(['public', `/events/${event.slug}`]);
  if (discussion) pages.push(['public', `/talk/${discussion.id}`]);

  pages.push(
    ['reader', '/account'],
    ['reader', '/talk/new'],
    ['reader', `/profile/${ids.reader}`],
    ['business', '/business'],
    ['business', `/business/${businessId}`],
    ['admin', '/admin'],
    ['admin', '/admin/news'],
    ['admin', '/admin/news/new'],
    ['admin', '/admin/submissions'],
    ['admin', '/admin/corrections'],
    ['admin', '/admin/events'],
    ['admin', '/admin/events/new'],
    ['admin', '/admin/links'],
    ['admin', '/admin/links/new'],
    ['admin', '/admin/media'],
    ['admin', '/admin/talk'],
    ['admin', '/admin/users'],
    ['admin', '/admin/users/log'],
    ['admin', '/admin/businesses'],
    ['admin', '/admin/ads'],
    ['admin', '/admin/facebook'],
  );
  if (anyArticle) pages.push(['admin', `/admin/news/${anyArticle.id}`]);
  if (anyEvent) pages.push(['admin', `/admin/events/${anyEvent.id}`]);
  const anyLink = firstRow('SELECT id FROM community_links ORDER BY updated_at DESC LIMIT 1');
  if (anyLink) pages.push(['admin', `/admin/links/${anyLink.id}`]);
  return pages;
}

// ---------------------------------------------------------------- browser helpers

/** Keeps runs local: no third-party requests, no ad-statistics beacons. */
async function isolate(context) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin && url.protocol !== 'data:' && url.protocol !== 'blob:') return route.abort();
    if (url.pathname.startsWith('/api/ads') || url.pathname.startsWith('/ads/')) return route.abort();
    return route.continue();
  });
}

async function newContext(browser, cookies, role, options = {}) {
  const context = await browser.newContext({ baseURL: BASE.origin, viewport: { width: 1280, height: 900 }, ...options });
  await isolate(context);
  if (role && role !== 'public') {
    await context.addCookies([{ name: 'better-auth.session_token', value: cookies[role], url: BASE.origin }]);
  }
  return context;
}

// Resources we deliberately block, and CSP report-only noise, are not rendering errors.
const IGNORED_CONSOLE = [/net::ERR_FAILED/, /Report Only/i, /Content Security Policy/i, /Failed to load resource/];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(message.text()))) errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function open(page, path) {
  const response = await page.goto(path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return response;
}

// ---------------------------------------------------------------- checks

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.log(`  FAIL ${message}`);
};

async function scanAxe(browser, cookies, pages) {
  console.log(`\naxe-core ${WCAG_TAGS.join(', ')}`);
  const contexts = new Map();
  let totalViolations = 0;
  for (const [role, path] of pages) {
    if (!contexts.has(role)) contexts.set(role, await newContext(browser, cookies, role));
    const page = await contexts.get(role).newPage();
    try {
      const response = await open(page, path);
      const status = response?.status() ?? 0;
      const landed = new URL(page.url());
      if (status !== 200 || (role !== 'public' && landed.pathname.startsWith('/sign-in'))) {
        fail(`${role} ${path}: expected the page, got HTTP ${status} at ${landed.pathname}`);
        continue;
      }
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('astro-dev-toolbar').analyze();
      const label = `${role.padEnd(8)} ${path}`;
      if (results.violations.length === 0) {
        console.log(`  ok   ${label}  (${results.passes.length} rules passed, ${results.incomplete.length} need review)`);
      } else {
        console.log(`  FAIL ${label}`);
        for (const violation of results.violations) {
          totalViolations += violation.nodes.length;
          console.log(`       ${violation.id} [${violation.impact}] x${violation.nodes.length}: ${violation.help}`);
          for (const node of violation.nodes.slice(0, 3)) {
            console.log(`         ${node.target.join(' ')}`);
            const why = [...node.any, ...node.all, ...node.none][0]?.message;
            if (why) console.log(`           ${why}`);
          }
        }
        failures.push(`${role} ${path}: ${results.violations.map((v) => v.id).join(', ')}`);
      }
    } finally {
      await page.close();
    }
  }
  for (const context of contexts.values()) await context.close();
  return totalViolations;
}

// A phone-width pass catches reflow and target-size problems the desktop viewport hides.
async function scanNarrow(browser, cookies, paths) {
  console.log('\naxe-core at 375px wide');
  const context = await newContext(browser, cookies, 'public', { viewport: { width: 375, height: 812 } });
  for (const path of paths) {
    const page = await context.newPage();
    await open(page, path);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('astro-dev-toolbar').analyze();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (results.violations.length === 0 && !overflow) console.log(`  ok   ${path}`);
    else {
      console.log(`  FAIL ${path}${overflow ? ' (horizontal scroll)' : ''}`);
      for (const violation of results.violations) console.log(`       ${violation.id} [${violation.impact}] x${violation.nodes.length}: ${violation.help}`);
      failures.push(`375px ${path}: ${[...results.violations.map((v) => v.id), ...(overflow ? ['horizontal-scroll'] : [])].join(', ')}`);
    }
    await page.close();
  }
  await context.close();
}

async function scanEmulation(browser, cookies, paths) {
  for (const [label, options] of [
    ['forced-colors: active', { forcedColors: 'active' }],
    ['prefers-reduced-motion: reduce', { reducedMotion: 'reduce' }],
  ]) {
    console.log(`\n${label}`);
    const context = await newContext(browser, cookies, 'public', options);
    for (const path of paths) {
      const page = await context.newPage();
      const errors = watchErrors(page);
      const response = await open(page, path);
      const media = await page.evaluate(() => ({
        forced: matchMedia('(forced-colors: active)').matches,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      }));
      const mainVisible = await page.locator('main').first().isVisible();
      const headingVisible = await page.locator('h1').first().isVisible();
      // Under reduced motion nothing may keep animating or transitioning for a noticeable time.
      const motion = options.reducedMotion
        ? await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length)
        : 0;
      const problems = [];
      if (response?.status() !== 200) problems.push(`HTTP ${response?.status()}`);
      if (options.forcedColors && !media.forced) problems.push('forced-colors was not applied');
      if (options.reducedMotion && !media.reduced) problems.push('reduced-motion was not applied');
      if (!mainVisible) problems.push('main landmark not visible');
      if (!headingVisible) problems.push('h1 not visible');
      if (motion) problems.push(`${motion} infinite animation(s) still running`);
      problems.push(...errors);
      if (problems.length === 0) console.log(`  ok   ${path}`);
      else fail(`${label} ${path}: ${problems.join('; ')}`);
      await page.close();
    }
    await context.close();
  }
}

/** Describes the focused element well enough to compare against the expected order. */
const describeFocus = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const indicator = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none';
  return {
    name: el.getAttribute('name') || el.id || (el.textContent || '').trim().slice(0, 30) || el.tagName.toLowerCase(),
    tag: el.tagName.toLowerCase(),
    visible: rect.width > 0 && rect.height > 0,
    indicator,
  };
};

async function keyboardSmokeTest(browser, cookies, path) {
  console.log(`\nkeyboard tab order: ${path}`);
  const context = await newContext(browser, cookies, 'public');
  const page = await context.newPage();
  await open(page, path);

  // Every control in the form, in DOM order, that a keyboard user should be able to reach.
  const expected = await page.evaluate(() =>
    [...document.querySelectorAll('main form input:not([type=hidden]):not(.hp), main form textarea, main form select, main form button')]
      .filter((el) => !el.disabled && el.getClientRects().length > 0 && el.tabIndex >= 0)
      .map((el) => el.getAttribute('name') || el.id || el.textContent.trim().slice(0, 30)),
  );
  if (expected.length < 3) fail(`${path}: found only ${expected.length} form controls`);

  const visited = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(describeFocus);
    // The Astro dev toolbar only exists under `astro dev`; reaching it means focus left the page content.
    if (!focus || focus.tag === 'astro-dev-toolbar') break;
    visited.push(focus);
    if (!focus.visible) fail(`${path}: focus moved to an element with no size (${focus.name})`);
    if (!focus.indicator) fail(`${path}: no visible focus indicator on ${focus.tag} "${focus.name}"`);
    if (visited.length > 1 && focus.name === visited[0].name && focus.tag === visited[0].tag) break;
  }

  if (visited[0]?.tag !== 'a' || !/skip/i.test(visited[0].name)) fail(`${path}: first Tab stop is not the skip link (got "${visited[0]?.name}")`);
  const names = visited.map((v) => v.name);
  let from = 0;
  for (const control of expected) {
    const at = names.indexOf(control, from);
    if (at === -1) fail(`${path}: Tab never reached "${control}" in source order`);
    else from = at + 1;
  }
  // Skip link plus a way out of the form: focus must keep moving, not trap.
  if (new Set(names).size < expected.length + 1) fail(`${path}: Tab order looks stuck (${names.length} stops)`);

  // Shift+Tab walks back the same way.
  await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(describeFocus);
  if (!back) fail(`${path}: Shift+Tab lost focus`);

  if (failures.length === 0 || !failures.some((f) => f.startsWith(path))) console.log(`  ok   ${expected.length} controls reached in order: ${expected.join(', ')}`);
  await context.close();
}

// ---------------------------------------------------------------- main

async function main() {
  try {
    const response = await fetch(BASE.origin, { redirect: 'manual' });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`No server answering at ${BASE.origin} (${error.message}). Start one first: npx astro dev --host ${BASE.hostname} --port ${BASE.port}`);
    process.exit(2);
  }

  cleanup(); // leftovers from an interrupted run
  const session = createTestSessions();
  let browser;
  const stop = () => {
    try { cleanup(); } catch { /* best effort on interrupt */ }
    process.exit(130);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    browser = await chromium.launch();
    console.log(`Chromium ${browser.version()}, Playwright ${JSON.parse(readFileSync(join(ROOT, 'node_modules/playwright/package.json'), 'utf8')).version}, axe-core ${JSON.parse(readFileSync(join(ROOT, 'node_modules/axe-core/package.json'), 'utf8')).version}`);
    console.log(`Scanning ${BASE.origin}`);
    const pages = pagesToScan(session);
    await scanAxe(browser, session.cookies, pages);
    const story = pages.find(([, path]) => path.startsWith('/news/'))?.[1] ?? '/news';
    await scanNarrow(browser, session.cookies, ['/', story, '/contact']);
    await scanEmulation(browser, session.cookies, ['/', story, '/events', '/sign-in']);
    await keyboardSmokeTest(browser, session.cookies, '/contact');
  } finally {
    await browser?.close();
    cleanup();
    console.log('\nRemoved the test users, sessions, and business from the local database.');
  }

  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nAll accessibility checks passed. Automated checks catch only part of what a person using assistive technology would find; see the README for the manual pass.');
}

main().catch((error) => {
  console.error(error);
  try { cleanup(); } catch { /* ignore */ }
  process.exit(1);
});
