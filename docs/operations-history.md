# Dated operations observations

These records preserve earlier checks and unresolved questions. They do not establish current service settings. Use the README for current setup and operating instructions, and the changelog and Git history for releases.

## September 29, 2026

The reader Facebook sign-in app was recorded as being in Development mode, with App Review for `email` and `public_profile`, app publication, and business-portfolio linking pending. Business verification was recorded as submitted September 28. Google, Apple, and Microsoft developer apps and credentials were recorded as unconfigured. Recheck those external settings before treating them as current. The Facebook publishing app is separate from the reader sign-in app.

## October 3, 2026

Search Console's events report, last updated October 1, showed 11 valid events and zero critical errors. Recommended-field warnings affected offers, images and performers on 11 items, end dates on three, and an organizer on one. Missing end-date examples were Parkrun, the Sandusky City Commission meeting, and Save Your Pumpkins 5K; the organizer example was Sandusky Farmers Market. A production spot check found blank offer, performer and image fields on four sampled events, plus no end time on Parkrun. These are historical crawl and page observations, not a current content inventory. Follow the README's event verification guidance when reviewing current warnings.

Production checks covered the calendar and four event pages (HTTP 200 and parseable Event JSON-LD), the signed-in editor's event fields, signed-out admin redirection, an `.ics` download, and the privacy notice. No event records were changed during those checks. Meta approval and current Facebook token access were not independently verified.

## October 12, 2026

Deployment controls review for issue #15, against the checklist in [operations.md](operations.md). Wrangler's token could not read zone settings or DNSSEC through the API, so those were observed from outside.

- **TLS and redirects.** Handshakes with TLS 1.0, 1.1, 1.2 and 1.3 all succeeded (Node/OpenSSL client), so the zone's minimum TLS version was still 1.0. `http://` and `www` redirected to `https://firelandscurrent.com/` with a 308, and `Strict-Transport-Security: max-age=31536000` was present.
- **DNS.** No DS record for `firelandscurrent.com` (DNSSEC off) and no CAA records.
- **Worker.** Secrets set: `BETTER_AUTH_SECRET`, `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `TURNSTILE_SECRET_KEY`; `SECURITY_ALERT_EMAIL` not set. `wrangler deployments list` showed recent versions available for rollback.
- **D1.** Production database on the current storage backend (889 kB, 33 tables), so Time Travel applies; on Workers Free its window is 7 days.
- **R2.** `firelands-current-media`: `r2.dev` public access disabled, no custom domain, no CORS configuration.
- **GitHub.** Public repository; `jmusick` is the only collaborator (admin); no deploy keys; no branch protection or rulesets (by choice); secret scanning and push protection on with no open alerts; Dependabot security updates off; Actions default token read-only, any action allowed, SHA pinning not required.
- **Secret history.** `npm run secrets:scan` (Gitleaks, every ref, redacted): 142 commits, no leaks.
- **Restore drill.** `node scripts/restore-drill.mjs` against the local database passed: 33 tables, 855 rows, 2 triggers, 33 migrations, 59 published stories, 48 media objects with matching sizes; export 2.0 s, restore 1.7 s. The first attempt, loading a single full export, failed with "no such table: main.events", which is why the drill restores schema, rows, and triggers separately.

Not checked (owner, dashboard only): WAF and cache rules, API token scopes, Workers Builds token, two-factor sign-in on Cloudflare, GitHub, Namecheap, Google and Meta, registrar lock, email routing destinations.

## Earlier completed service checks

The following dated observations were preserved from the October 4 backlog snapshot during the October 10 cleanup. They have not been reverified as current service settings.

- **Review Google Analytics and Search Console configuration — October 3, 2026.** Confirmed the live GA measurement ID `G-WCZR3LZNP7`, active collection, New York reporting time zone, 14-month event and user data retention, enabled enhanced measurement, and the correct GSC domain-property link (linked September 28). Google signals and user-provided data collection were off. GSC reported valid robots.txt files, no host problems, no manual actions or security issues, and 11 valid events with zero invalid events. Recorded remaining improvements in the backlog; no account settings or site code were changed during the audit.

- **Recheck Google News sitemap processing in Search Console — October 3, 2026.** The earlier "Couldn't fetch" status cleared. Both submitted sitemaps showed Success and were last read October 2: `/news-sitemap.xml` had 11 discovered pages and `/sitemap.xml` had 67. Sitemap discovery does not establish that every URL is indexed.

- **Add, deploy, and submit a dedicated Google News sitemap — October 2, 2026.** Released in v1.18.0; the live `/news-sitemap.xml` includes published stories from the last 48 hours with publication metadata, original dates, and headlines. `/robots.txt` advertises both sitemaps, and older stories remain in the ordinary sitemap. Submitted to Search Console; successful processing was confirmed October 3 as noted above.

- **Verify Firelands Current in Google Search Console — October 2, 2026.** Confirmed verified ownership of `firelandscurrent.com` and the existing `/sitemap.xml` submission (Success; 57 discovered pages; last read October 1). Live URL tests passed for the voter-registration, winter-clothing-drive, and recreation-center membership stories. Requested indexing for the first two, which were not yet indexed; the recreation-center story was already indexed. Google News considers eligible sites automatically; Publisher Center no longer provides an inclusion application.
