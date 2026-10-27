import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
const statement = (sql) => {
  const prepared = database.prepare(sql);
  let values = [];
  const query = {
    bind(...args) { values = args; return query; },
    async all() { return { results: prepared.all(...values) }; },
  };
  return query;
};
globalThis.__adsTestEnv = { DB: { prepare: statement, batch: (statements) => Promise.all(statements.map((s) => s.all())) } };

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs = {
  'cloudflare:workers': stub('export const env = globalThis.__adsTestEnv;'),
  './ad-tracking': stub("export const signEvent = async (id) => `signed-${id}`; export const statDay = () => '2026-10-27';"),
  './media': stub('export const mediaUrl = (key) => `/media/${key}`;'),
  './news': stub("export const SECTIONS = { local: 'Local News', business: 'Business', schools: 'Schools' };"),
};
const source = ts.transpileModule(readFileSync(new URL('../src/lib/ads.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => `from ${JSON.stringify(stubs[specifier] ?? specifier)}`);
const { AdPlan, HOUSE_ADS, HOUSE_SHARE, adPlanFor } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// A small seeded generator (mulberry32), so the share checks give the same answer on every run.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const theme = { bg: '#000000', fg: '#ffffff', accent: '#cccccc' };
const booked = (id, extra = {}) => ({
  id, businessId: `biz-${id}`, advertiser: `Business ${id}`, kind: 'booked', images: {}, headline: 'Headline', body: '', cta: 'Go',
  href: 'https://example.test/', theme, placements: [], sections: [], weight: 5, ...extra,
});
const campaigns = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => booked(id));
const HOME = ['site-leaderboard', 'home-rail', 'home-billboard'];
const render = async (plan, placements) => {
  const served = [];
  for (const placement of placements) served.push(await plan.take(placement));
  return served;
};

test('house promos', async (t) => {
  await t.test('every promo is a text creative from the paper', () => {
    assert.deepEqual(HOUSE_ADS.map((ad) => ad.href).sort(), ['/advertise', '/events', '/submit-news', '/talk']);
    for (const ad of HOUSE_ADS) {
      assert.equal(ad.kind, 'house');
      assert.equal(ad.advertiser, 'Firelands Current');
      assert.deepEqual(ad.images, {});
      assert.deepEqual(ad.placements, []);
      assert.ok(ad.headline && ad.body && ad.cta);
    }
  });

  await t.test(`take about ${HOUSE_SHARE * 100}% of slots booked ads could fill`, async () => {
    const random = seeded(100);
    const draws = 20000;
    let house = 0;
    for (let i = 0; i < draws; i++) {
      const [{ ad }] = await render(new AdPlan(campaigns, { pathname: '/' }, true, random), ['home-rail']);
      if (ad.kind === 'house') house++;
    }
    assert.ok(Math.abs(house / draws - HOUSE_SHARE) < 0.015, `house share was ${house / draws}`);
  });

  await t.test('appear at most once per page when booked ads are eligible', async () => {
    const random = seeded(7);
    let pagesWithPromo = 0;
    let slots = 0;
    for (let i = 0; i < 5000; i++) {
      const served = await render(new AdPlan(campaigns, { pathname: '/' }, true, random), HOME);
      const promos = served.filter(({ ad }) => ad.kind === 'house').length;
      assert.ok(promos <= 1, `page ${i} showed ${promos} house promos`);
      pagesWithPromo += promos;
      slots += served.length;
    }
    // Each slot has the same chance until a promo runs, so 1 − 0.75³ (about 58%) of three-slot pages get one,
    // and the cap brings the promos' share of all slots on such a page a little under HOUSE_SHARE, to about 19%.
    const expected = 1 - (1 - HOUSE_SHARE) ** 3;
    assert.ok(Math.abs(pagesWithPromo / 5000 - expected) < 0.03, `pages with a promo: ${pagesWithPromo / 5000}`);
    assert.ok(Math.abs(pagesWithPromo / slots - expected / 3) < 0.01, `house slots: ${pagesWithPromo / slots}`);
  });

  await t.test('never link to the page they appear on', async () => {
    const pages = {
      '/talk': '/talk', '/talk/': '/talk', '/talk/abc123': '/talk', '/submit-news': '/submit-news',
      '/events': '/events', '/events/fall-festival': '/events', '/events/fall-festival.ics': '/events', '/advertise': '/advertise',
    };
    for (const [pathname, own] of Object.entries(pages)) {
      const random = seeded(pathname.length);
      const seen = new Set();
      for (let i = 0; i < 400; i++) {
        // With nothing booked every slot is a promo, so the fallback is checked too.
        for (const { ad } of await render(new AdPlan(i % 2 ? [] : campaigns, { pathname }, true, random), HOME)) {
          if (ad.kind === 'house') seen.add(ad.href);
        }
      }
      assert.ok(!seen.has(own), `${pathname} showed the ${own} promo`);
      assert.equal(seen.size, HOUSE_ADS.length - 1, `${pathname} showed ${[...seen]}`);
    }
    const random = seeded(3);
    const seen = new Set();
    for (let i = 0; i < 200; i++) for (const { ad } of await render(new AdPlan([], { pathname: '/talking-points' }, true, random), HOME)) seen.add(ad.href);
    assert.ok(seen.has('/talk'), 'a path that only starts with /talk still gets the Talk promo');
  });

  await t.test('fill every slot when nothing booked fits, varying the promos', async () => {
    const random = seeded(11);
    const onlyRail = [booked('rail', { placements: ['home-rail'] })];
    for (let i = 0; i < 500; i++) {
      const served = await render(new AdPlan(onlyRail, { pathname: '/' }, true, random), HOME);
      assert.equal(served.length, 3);
      const promos = served.filter(({ ad }) => ad.kind === 'house');
      assert.ok(promos.length >= 2, 'leaderboard and billboard have nothing booked');
      assert.equal(new Set(promos.map(({ ad }) => ad.id)).size, promos.length, 'a page repeats a promo only after showing them all');
    }
    const served = await render(new AdPlan([], { pathname: '/' }, true, seeded(5)), [...HOME, ...HOME]);
    assert.ok(served.every(({ ad }) => ad.kind === 'house'));
    assert.equal(new Set(served.slice(0, 4).map(({ ad }) => ad.id)).size, 4);
  });

  await t.test('leave booked-ad accounting alone', async () => {
    const random = seeded(21);
    let bookedSeen = 0;
    let houseSeen = 0;
    for (let i = 0; i < 400; i++) {
      for (const { ad, href, token } of await render(new AdPlan(campaigns, { pathname: '/' }, true, random), HOME)) {
        if (ad.kind === 'house') {
          houseSeen++;
          assert.equal(token, null);
          assert.equal(href, ad.href);
        } else {
          bookedSeen++;
          assert.equal(token, `signed-${ad.id}`);
          assert.equal(href, `/ads/click?t=${encodeURIComponent(token)}`);
        }
      }
    }
    assert.ok(houseSeen > 0 && bookedSeen > 0);
  });

  await t.test('still keep one ad per advertiser and prefer section-targeted ads', async () => {
    const random = seeded(31);
    const ads = [booked('school', { sections: ['schools'] }), booked('any'), booked('any-2', { businessId: 'biz-any' })];
    for (let i = 0; i < 300; i++) {
      const served = await render(new AdPlan(ads, { section: 'schools', pathname: '/news' }, true, random), ['article-rail', 'article-inline', 'article-inline']);
      const advertisers = served.filter(({ ad }) => ad.kind === 'booked').map(({ ad }) => ad.businessId);
      assert.equal(new Set(advertisers).size, advertisers.length);
      if (served[0].ad.kind === 'booked') assert.equal(served[0].ad.id, 'school');
    }
  });
});

test('sample ads', async (t) => {
  const page = (path = '/') => new Request(`https://firelandscurrent.test${path}`);
  const kindsOnHome = async () => {
    const plan = await adPlanFor(page(), {});
    assert.equal(plan.context.pathname, '/');
    return (await render(plan, HOME)).map(({ ad }) => ad.kind);
  };
  const realRandom = Math.random;
  // Push every draw past the house share so the first slot shows what the inventory offers.
  Math.random = () => 0.99;
  t.after(() => { Math.random = realRandom; });

  await t.test('run only while the ads table is empty', async () => {
    assert.equal((await kindsOnHome())[0], 'sample');
    database.exec(`INSERT INTO businesses (id, name, kind, created_at, updated_at) VALUES ('biz-test', 'Test Shop', 'advertiser', 1, 1)`);
    database.exec(`INSERT INTO ads (id, business_id, name, status, headline, cta, href, theme_bg, theme_fg, theme_accent, created_at, updated_at)
      VALUES ('ad-paused', 'biz-test', 'Paused', 'paused', 'Paused ad', 'Go', 'https://example.test/', '#000', '#fff', '#ccc', 1, 1)`);
    // A booked ad that can't run leaves its slots to the paper, not to the samples.
    assert.deepEqual(await kindsOnHome(), ['house', 'house', 'house']);
    database.exec(`UPDATE ads SET status = 'active' WHERE id = 'ad-paused'`);
    assert.deepEqual(await kindsOnHome(), ['booked', 'house', 'house']);
  });

  await t.test('pass the request path to the plan', async () => {
    const plan = await adPlanFor(page('/events/fall-festival'), {}, { section: 'local' });
    assert.deepEqual(plan.context, { pathname: '/events/fall-festival', section: 'local' });
  });
});
