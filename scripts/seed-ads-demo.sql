-- Demo advertisers, ads and 45 days of stats. Local development only.
-- Businesses and ads are fictional. Re-runnable: removes previous demo rows (ids prefixed "demo-") first.
--   npx wrangler d1 execute DB --local --file scripts/seed-ads-demo.sql

DELETE FROM admin_audit_log WHERE target_ad_id LIKE 'demo-%' OR target_business_id LIKE 'demo-biz-%';
DELETE FROM ads WHERE id LIKE 'demo-%';
DELETE FROM businesses WHERE id LIKE 'demo-biz-%';

INSERT INTO businesses (id, name, kind, website, email, created_at, updated_at) VALUES
  ('demo-biz-hardware', 'Cedar Street Hardware (demo)', 'advertiser', 'https://example.com/hardware', 'ads@hardware.example', unixepoch() * 1000, unixepoch() * 1000),
  ('demo-biz-dental', 'Lakeshore Family Dental (demo)', 'advertiser', 'https://example.com/dental', 'office@dental.example', unixepoch() * 1000, unixepoch() * 1000),
  ('demo-biz-bakery', 'Old Firehouse Bakery (demo)', 'advertiser', 'https://example.com/bakery', NULL, unixepoch() * 1000, unixepoch() * 1000);

INSERT INTO ads (id, business_id, name, status, headline, body, cta, href, theme_bg, theme_fg, theme_accent, placements, sections, weight, starts_on, ends_on, impression_cap, terms, created_at, updated_at) VALUES
  ('demo-ad-dock', 'demo-biz-hardware', 'Dock season — fall', 'active', 'Get your dock ready for winter', 'Shrink wrap, marine hardware and friendly advice since 1962.', 'Shop the dock aisle', 'https://example.com/hardware/dock',
   '#2f4a3a', '#f4efe2', '#e6b35a', '[]', '["outdoors","community"]', 6, date('now', '-44 days'), date('now', '+30 days'), NULL, '$300/month, run of site', unixepoch() * 1000, unixepoch() * 1000),
  ('demo-ad-paint', 'demo-biz-hardware', 'Paint sale — October', 'active', 'All exterior paint 20% off', 'Through the end of October.', 'See the sale', 'https://example.com/hardware/paint',
   '#fbeee2', '#5a2a18', '#a45636', '["site-leaderboard","article-rail"]', '[]', 4, date('now', '-10 days'), date('now', '+20 days'), 50000, '$200 flat', unixepoch() * 1000, unixepoch() * 1000),
  ('demo-ad-dental', 'demo-biz-dental', 'New patients', 'active', 'New patients welcome', 'Evening and Saturday appointments for the whole family.', 'Book a visit', 'https://example.com/dental',
   '#e8f1f2', '#173d4a', '#257583', '[]', '[]', 5, date('now', '-30 days'), NULL, NULL, '$250/month', unixepoch() * 1000, unixepoch() * 1000),
  ('demo-ad-bakery', 'demo-biz-bakery', 'Pierogi Fridays', 'paused', 'Fresh pierogi every Friday', 'Plus pies, kolaches and coffee in the old station on Main.', 'See this week’s menu', 'https://example.com/bakery',
   '#8a3b22', '#fff6ec', '#f2c48d', '["news-feed","talk-feed"]', '["community","local"]', 5, date('now', '-20 days'), NULL, NULL, 'Trade: pies for the newsroom', unixepoch() * 1000, unixepoch() * 1000),
  ('demo-ad-holiday', 'demo-biz-bakery', 'Holiday pre-orders', 'draft', 'Order holiday pies early', 'Pre-orders open November 1.', 'Pre-order', 'https://example.com/bakery/holiday',
   '#173d4a', '#edf2ed', '#e7a98d', '[]', '[]', 5, date('now', '+35 days'), date('now', '+60 days'), NULL, NULL, unixepoch() * 1000, unixepoch() * 1000);

-- Daily numbers with a weekly rhythm (busier early in the week) and some noise.
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 44),
runs(ad_id, placement, base, rate, start_n) AS (VALUES
  ('demo-ad-dock', 'site-leaderboard', 420, 0.0035, 44), ('demo-ad-dock', 'article-rail', 180, 0.006, 44), ('demo-ad-dock', 'home-billboard', 90, 0.009, 44),
  ('demo-ad-paint', 'site-leaderboard', 380, 0.004, 10), ('demo-ad-paint', 'article-rail', 140, 0.007, 10),
  ('demo-ad-dental', 'site-leaderboard', 300, 0.003, 30), ('demo-ad-dental', 'home-rail', 150, 0.005, 30), ('demo-ad-dental', 'article-inline', 110, 0.008, 30),
  ('demo-ad-bakery', 'news-feed', 160, 0.012, 20), ('demo-ad-bakery', 'talk-feed', 70, 0.015, 20)),
daily AS (
  SELECT r.ad_id, r.placement, date('now', printf('-%d days', d.n)) AS day,
         CAST(r.base * (1.15 - 0.05 * ((d.n + 3) % 7)) * (0.8 + (abs(random()) % 40) / 100.0) AS INTEGER) AS impressions, r.rate
  FROM runs r JOIN days d ON d.n <= r.start_n
  -- The bakery ad was paused five days ago.
  WHERE NOT (r.ad_id = 'demo-ad-bakery' AND d.n < 5)
)
INSERT INTO ad_stats (ad_id, day, placement, impressions, clicks)
SELECT ad_id, day, placement, impressions, CAST(impressions * rate * (0.5 + (abs(random()) % 100) / 100.0) + 0.5 AS INTEGER) FROM daily;

UPDATE ads SET
  impressions = (SELECT COALESCE(SUM(impressions), 0) FROM ad_stats WHERE ad_id = ads.id),
  clicks = (SELECT COALESCE(SUM(clicks), 0) FROM ad_stats WHERE ad_id = ads.id)
WHERE id LIKE 'demo-%';
