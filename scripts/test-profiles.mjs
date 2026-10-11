import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { hashPassword } from 'better-auth/crypto';

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
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
  async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
};
globalThis.__profileTestEnv = { DB: db, SITE_URL: 'http://localhost:4321', BETTER_AUTH_SECRET: 'profile-regression-secret-at-least-32-characters', TURNSTILE_SECRET_KEY: 'test-secret' };
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__profileTestEnv;')}`;
const modules = new Map();
function loadSource(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => {
    const url = specifier === 'cloudflare:workers' ? envModule : replacements[specifier] ?? import.meta.resolve(specifier);
    return `from ${JSON.stringify(url)}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(path, url);
  return import(url);
}
const { getProfile, profileItems } = await loadSource('src/lib/profiles.ts');
const { listArticles } = await loadSource('src/lib/news.ts');
await loadSource('src/lib/forum.ts');
const { saveArticleFromForm } = await loadSource('src/lib/news-admin.ts', {
  './news': modules.get('src/lib/news.ts'), './forum': modules.get('src/lib/forum.ts'),
  './media': 'data:text/javascript,export const isMediaId = () => false;',
});
globalThis.__profileTestMail = [];
await loadSource('src/lib/auth-rate-limit.ts');
await loadSource('src/lib/password-policy.ts');
await loadSource('src/lib/reauth.ts');
const { createAuth } = await loadSource('src/lib/auth.ts', {
  './mail': 'data:text/javascript,export const sendVerificationMail = async (user, url) => globalThis.__profileTestMail.push({ user, url }); export const sendPasswordResetMail = async () => {};',
  './auth-rate-limit': modules.get('src/lib/auth-rate-limit.ts'),
  './password-policy': modules.get('src/lib/password-policy.ts'),
  './reauth': modules.get('src/lib/reauth.ts'),
});
function user(id, email = `${id}@example.test`) {
  database.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, email, new Date().toISOString(), new Date().toISOString());
}
function article(id, status = 'published') {
  database.prepare(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, published_at, created_at, updated_at)
    VALUES (?, ?, ?, 'A sufficiently long summary.', 'A sufficiently long story body.', 'local', 'Sandusky', 'Original Writer', ?, 1000, 1000, 1000)`)
    .run(id, id, `Headline for ${id}`, status);
}
function topic(id, { status = 'published', articleId = null, eventId = null } = {}) {
  database.prepare(`INSERT INTO forum_threads (id, author_id, title, body, status, article_id, event_id, created_at, updated_at, last_activity_at)
    VALUES (?, 'jd', ?, 'Topic body', ?, ?, ?, 1000, 1000, 1000)`).run(id, id, status, articleId, eventId);
  database.prepare(`INSERT INTO forum_replies (id, thread_id, author_id, body, status, created_at, updated_at)
    VALUES (?, ?, 'jd', 'Visible reply', 'published', 1000, 1000)`).run(`reply-${id}`, id);
}

test('account profiles, author assignment, and email verification', async (t) => {
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
    if (name.startsWith('0017')) continue;
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  user('jd', 'jd@orboro.net');
  user('other');
  article('published'); article('draft', 'draft');
  const migration = readFileSync(new URL('../migrations/0017_article_authors.sql', import.meta.url), 'utf8');
  database.exec(migration);

  await t.test('migration assigns existing published stories and drafts without changing dates', () => {
    const rows = database.prepare('SELECT author_id, byline, published_at FROM news_articles').all();
    assert.equal(rows.length, 2);
    for (const row of rows) assert.deepEqual({ ...row }, { author_id: 'jd', byline: 'JD', published_at: 1000 });
    const empty = new DatabaseSync(':memory:');
    empty.exec('CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE news_articles (id TEXT, byline TEXT, status TEXT, published_at INTEGER); INSERT INTO news_articles VALUES (\'existing\', \'Guest\', \'published\', 1000);');
    empty.exec(migration);
    assert.equal(empty.prepare('SELECT byline FROM news_articles').get().byline, 'Guest');
    empty.close();
  });

  await t.test('profiles expose only public identity and filter hidden content and draft sources', async () => {
    assert.deepEqual({ ...await getProfile('jd') }, { id: 'jd', name: 'jd' });
    assert.equal(await getProfile('missing'), null);
    assert.equal(await getProfile("' OR 1=1 --"), null);
    assert.deepEqual((await profileItems('jd', 'articles', 0)).map((item) => item.id), ['published']);
    topic('community'); topic('hidden', { status: 'hidden' });
    topic('draft-story', { articleId: 'draft' }); topic('published-story', { articleId: 'published' });
    for (const status of ['draft', 'published', 'cancelled']) {
      database.prepare(`INSERT INTO events (id, slug, title, summary, category, starts_on, venue, community, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Event summary', 'community', '2026-10-02', 'Venue', 'Sandusky', ?, 1000, 1000)`).run(status, status, status, status);
      topic(`${status}-event`, { eventId: status });
    }
    database.prepare("INSERT INTO forum_replies (id, thread_id, author_id, body, status, created_at, updated_at) VALUES ('hidden-reply', 'community', 'jd', 'Private reply', 'hidden', 1000, 1000)").run();
    const expected = ['cancelled-event', 'community', 'published-event', 'published-story'];
    assert.deepEqual((await profileItems('jd', 'topics', 0)).map((item) => item.id).sort(), expected);
    assert.deepEqual((await profileItems('jd', 'replies', 0)).map((item) => item.id).sort(), expected.map((id) => `reply-${id}`));
  });

  await t.test('pagination is stable even when timestamps match', async () => {
    for (let index = 0; index < 25; index++) {
      article(`paged-${index}`);
      database.prepare("UPDATE news_articles SET author_id = 'other' WHERE id = ?").run(`paged-${index}`);
    }
    const first = await profileItems('other', 'articles', 0);
    const second = await profileItems('other', 'articles', 1);
    assert.equal(first.length, 21); assert.equal(second.length, 5);
    assert.equal(new Set([...first.slice(0, 20), ...second].map((item) => item.id)).size, 25);
  });

  await t.test('editor validates authors and preserves guest bylines', async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ headline: 'New regression story', summary: 'A sufficiently long summary.', body: 'A sufficiently long story body.', section: 'local', community: 'Sandusky', byline: 'Guest Writer', author_id: 'missing', status: 'draft' })) form.set(key, value);
    assert.equal((await saveArticleFromForm(form, null)).ok, false);
    form.set('author_id', 'jd');
    let saved = await saveArticleFromForm(form, null);
    assert.equal(saved.ok, true);
    assert.equal(database.prepare('SELECT author_id FROM news_articles WHERE id = ?').get(saved.id).author_id, 'jd');
    form.set('author_id', ''); form.set('slug', 'guest-story');
    saved = await saveArticleFromForm(form, null);
    assert.equal(saved.ok, true);
    assert.deepEqual({ ...database.prepare('SELECT author_id, byline FROM news_articles WHERE id = ?').get(saved.id) }, { author_id: null, byline: 'Guest Writer' });
  });

  await t.test('name changes propagate, and deleting an account preserves its articles', async () => {
    database.prepare("UPDATE user SET name = 'Updated Name' WHERE id = 'jd'").run();
    assert.equal((await listArticles()).find((item) => item.id === 'published').byline, 'Updated Name');
    database.prepare("DELETE FROM user WHERE id = 'other'").run();
    const kept = database.prepare("SELECT author_id, byline FROM news_articles WHERE id = 'paged-0'").get();
    assert.equal(kept.author_id, null); assert.equal(kept.byline, 'Original Writer');
  });

  await t.test('real auth handlers validate names and require verification before replacing email', async () => {
    const password = await hashPassword('test-password-for-profile');
    const now = new Date().toISOString();
    database.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('credential', 'jd', 'credential', 'jd', ?, ?, ?)").run(password, now, now);
    const auth = createAuth();
    let cookie = '';
    // A fresh client IP per request keeps these checks clear of the per-IP auth rate limits.
    let address = 0;
    const request = (path, body, token) => auth.handler(new Request(`http://localhost:4321/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4321', cookie, 'cf-connecting-ip': `192.0.2.${++address}`, ...(token ? { 'x-captcha-response': token } : {}) }, body: JSON.stringify(body),
    }));
    const signedIn = await request('sign-in/email', { email: 'jd@orboro.net', password: 'test-password-for-profile' });
    assert.equal(signedIn.status, 200);
    cookie = signedIn.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    assert.equal((await request('update-user', { name: '   ' })).status, 400);
    assert.equal((await request('update-user', { name: 'x'.repeat(81) })).status, 400);
    assert.equal((await request('update-user', { name: '  JD  ' })).status, 200);
    assert.equal((await getProfile('jd')).name, 'JD');
    const anonymous = await auth.handler(new Request('http://localhost:4321/api/auth/update-user', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4321' }, body: JSON.stringify({ name: 'Unauthorized' }),
    }));
    assert.equal(anonymous.status, 401);
    const crossOrigin = await auth.handler(new Request('http://localhost:4321/api/auth/update-user', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example', cookie }, body: JSON.stringify({ name: 'Unauthorized' }),
    }));
    assert.equal(crossOrigin.status, 403);
    assert.ok((await request('change-email', { newEmail: 'new@example.test' })).status >= 400);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('challenges.cloudflare.com/turnstile')) return Response.json({ success: true });
      return originalFetch(url, init);
    };
    try {
      user('taken', 'taken@example.test');
      assert.equal((await request('change-email', { newEmail: 'taken@example.test' }, 'test-token')).status, 200);
      assert.equal(globalThis.__profileTestMail.length, 0);
      database.prepare("UPDATE session SET createdAt = ? WHERE userId = 'jd'").run(new Date(Date.now() - 2 * 86400000).toISOString());
      assert.ok((await request('change-email', { newEmail: 'new@example.test' }, 'test-token')).status >= 400);
      assert.equal(globalThis.__profileTestMail.length, 0);
      database.prepare("UPDATE session SET createdAt = ? WHERE userId = 'jd'").run(now);
      assert.equal((await request('change-email', { newEmail: 'new@example.test', callbackURL: '/account?verified=1' }, 'test-token')).status, 200);
      assert.equal(database.prepare("SELECT email FROM user WHERE id = 'jd'").get().email, 'jd@orboro.net');
      assert.equal(globalThis.__profileTestMail.length, 1);
      const mail = globalThis.__profileTestMail[0];
      assert.equal(mail.user.email, 'new@example.test');
      const confirmed = await auth.handler(new Request(mail.url, { headers: { cookie } }));
      assert.equal(confirmed.status, 302);
      assert.equal(database.prepare("SELECT email FROM user WHERE id = 'jd'").get().email, 'new@example.test');
      assert.equal((await getProfile('jd')).id, 'jd');
    } finally { globalThis.fetch = originalFetch; }
  });
  database.close();
});
