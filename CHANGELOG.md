# Changelog

All notable changes to Firelands Current are recorded here. The site follows [Semantic Versioning](https://semver.org/): the version lives in `package.json` and is shown in the site footer.

## [1.27.3] - 2026-10-11

### Security

- Passwords are now hashed with scrypt at OWASP's 16 MiB profile (N=2^14, r=8, p=5), stored as a self-describing `$scrypt$` string so the cost can be raised later without a migration. Sign-up, sign-in, password change and reset, admin-created accounts, admin password resets and `/reauth` all share one implementation. Existing hashes keep working and are upgraded transparently the next time their owner signs in or confirms their password; no one has to reset. Checks of old and new hashes take about the same time, so sign-in timing doesn't reveal which accounts haven't been upgraded, and a damaged hash is treated as a wrong password. The README records the measured costs (#47)

## [1.27.2] - 2026-10-11

### Fixed

- Raised the contrast of the "Advertisement" and "Sponsored" labels on ads, and of Markdown links, quotes and the word count in the story editor, to meet WCAG AA. Ad and business links in the admin ads list now have larger click targets (#26)

### Added

- `npm run test:a11y` runs axe-core (WCAG 2.0–2.2 A and AA) with Playwright and Chromium over the main public, account, business and staff pages of a local server. It also checks phone-width layout, forced-colors and reduced-motion modes, and keyboard Tab order on the contact form, and removes the test accounts it creates. The accessibility statement now describes this scan; the screen-reader pass is still to come (#26)

## [1.27.1] - 2026-10-11

### Security

- New `npm run test:authorization` regression suite checks access rules against the real middleware, Better Auth sessions, endpoints and migrations in an isolated database. Every endpoint must be listed with its guard, so a new one can't ship unclassified. Each data-changing request is sent as a signed-out visitor, a suspended account, a reader, a business owner and every staff role, and refusals must change nothing. It also covers cross-origin posts, suspensions and role removals taking effect on the next request, business members guessing other businesses' IDs, forged ad tokens, author-bio edits, and the session cookie's `HttpOnly`, `Secure` and `SameSite` attributes. No authorization bugs were found (#16)

## [1.27.0] - 2026-10-11

### Added

- Staff can write a short author bio (up to 600 characters of plain text) about their local experience and coverage. Staff edit their own under **Author bio** on `/account`, and administrators can edit any staff member's from `/admin/users/<id>`; an administrator's edit is recorded in the activity log by length only, never the text. The bio appears on the person's public profile and under their byline on stories, only while the account holds a staff role. Migration `0030_staff_bios.sql` adds the `staff_bios` table, and the Privacy Policy describes the new public field (#38)

## [1.26.0] - 2026-10-11

### Added

- Story pages end with a "Related coverage" list of up to four other published stories: ones in the same section rank first, then ones about the same community, newest first within each. Stories that share neither never appear, and the list is left out when nothing qualifies. Migration `0029_related_coverage_index.sql` adds an index for the community lookup (#37)

## [1.25.0] - 2026-10-11

### Added

- News tips now follow a retention schedule, applied once a day by the existing scheduled Worker: declined tips are deleted 90 days after they were declined, and tips the newsroom reviewed or turned into a story keep their text but lose the submitter's name, email and account link a year after the decision. Unread tips are never deleted for age; the inbox flags ones older than 90 days. Deleting an account deletes its unread and declined tips. Each tip has a new "Remove submitter details" action, and the inbox can be filtered by account or submitter email to answer data requests. Runs and removals are recorded in the activity log with counts only. Migration `0028_tip_retention.sql` adds `decided_at`, `anonymized_at` and a `scheduled_jobs` table. The Privacy Policy and README state the periods and the newsroom mailbox procedure (#52)

## [1.24.1] - 2026-10-11

### Security

- Commits and pushes are now scanned for secrets with a pinned, checksum-verified Gitleaks 8.30.1. `npm run hooks:install` enables `pre-commit` and `pre-push` hooks that block on findings and fail closed when the scanner is missing, and a `Secret scan` GitHub Actions workflow scans full history on pull requests and pushes to `main`. Reports are redacted and never written to tracked files; the only allowlist entry covers made-up test-fixture secrets. Dependabot now also keeps the SHA-pinned Actions current. The README covers setup, the `--no-verify` emergency bypass, and why the build itself doesn't run the scan (#49)

## [1.24.0] - 2026-10-11

### Added

- An Accessibility page at `/accessibility` gives readers a way to report barriers (the contact form or email), states WCAG 2.2 AA as a goal without claiming conformance, says what has and hasn't been tested, and lists known limitations such as the Turnstile human check and ad image descriptions. It is linked from the footer and listed in the sitemap. New newsroom guidance in `docs/accessible-publishing.md` covers image descriptions, headings, link text, tables, charts, and captions for any future audio or video (#27)

## [1.23.1] - 2026-10-11

### Changed

- Google Analytics now receives three outcome events, sent only after the action succeeds and counted once: `sign_up` (with the sign-in method) when an account is created, `news_tip_submitted` when a tip is accepted, and `advertiser_inquiry` when an advertising inquiry is accepted. No names, email addresses or form contents are sent. Because account pages don't load analytics, a new account's event waits in local storage until the next public page. The Privacy Policy and README describe the events (#57)

## [1.23.0] - 2026-10-11

### Added

- An About page at `/about` explains who publishes Firelands Current, the coverage area, how stories are sourced and attributed, bylines, the corrections process, how advertising is kept apart from news, community discussion rules, and how to send a tip. It is linked from the footer, listed in the sitemap, and carries `AboutPage` structured data (#29)

## [1.22.35] - 2026-10-11

### Security

- The admin activity log now records newsroom actions: story creation, edits (changed field names only), publishing, featuring and deletion; event changes, cancellations and deletions; discussion moderation; correction decisions; and news tips converted to stories. Entries hold ids and titles, never story, tip or submitter text, and link to the record while it exists. A signed-in account refused by an admin endpoint leaves a throttled "denied" entry. Sign-in, sign-up, password, email, linking and session events are written to Workers Logs as structured lines with keyed hashes in place of email and IP addresses. Migration `0027_audit_resources.sql` adds the resource and outcome columns. The README covers access and retention, and the Privacy Policy describes both records (#51)

## [1.22.34] - 2026-10-11

### Security

- Image uploads now have their metadata stripped on the server for every accepted format, including GIFs and direct API uploads that skip the browser's redraw: EXIF, XMP, IPTC, comments, text chunks and trailing data are removed from JPEG, PNG, WebP and GIF files while pixels and colour profiles stay intact. Malformed or truncated files are refused instead of stored. If saving an upload's library record fails after the file reaches storage, the new file is removed once checks confirm nothing refers to it, so failed uploads no longer leave orphaned files. The README documents the policy per format (#54)

## [1.22.33] - 2026-10-11

### Security

- Signing in with Google, Facebook, Apple or Microsoft no longer leaves that service's access, refresh or ID tokens in the account table: they are dropped on every account write, and migration `0026_clear_oauth_tokens.sql` clears the ones earlier sign-ins stored. Better Auth's token encryption is also on as a second layer. Sign-in, linking and unlinking work as before. The Privacy Policy and README describe the change, including key rotation (#48)

## [1.22.32] - 2026-10-11

### Changed

- Story links posted to the Facebook Page now carry `utm_source=facebook`, `utm_medium=social` and `utm_campaign=story_share`, so Google Analytics can attribute those visits instead of counting them as Direct. The Facebook ledger and the page's canonical URL stay free of tracking parameters, and a shared `campaignUrl` helper holds the convention for future newsletter links (#58)

## [1.22.31] - 2026-10-11

### Security

- npm now only resolves package versions published at least seven days ago (`min-release-age=7` in `.npmrc`), and Dependabot waits the same week before proposing an update, so a compromised release has time to be pulled before it reaches the lockfile. Lockfile installs, including the Cloudflare build, are unaffected. The README documents a reviewed emergency-exception process (#50)

## [1.22.30] - 2026-10-11

### Fixed

- The admin story list can filter to Featured or Not featured alongside search, publication status and section. Links with `featured=1` or `featured=0` open the corresponding selection, making it easier to manage the rotating homepage lead.

### Changed

- Updated newsroom source guidance for Norwalk's city calendar, Erie MetroParks programs and The Chef's Garden, with the Maritime Museum of Sandusky and Ottawa National Wildlife Refuge added as prospects. Added today's editorial preparation, local import and production sync utilities; reporting evidence, content snapshots and photo downloads stay in the separate project library.

## [1.22.29] - 2026-10-11

### Security

- Every HTML page now sends a Content Security Policy in report-only mode, so browsers report anything outside it without blocking it. Scripts run only with a per-response nonce plus `'strict-dynamic'` (no inline-script or eval allowance); images, fonts, connections, and frames are limited to this site, Google Analytics and Fonts, Cloudflare Web Analytics, and Turnstile; `object-src`, `base-uri`, `form-action`, and `frame-ancestors` are locked down. Violations go to `/api/csp-report`, which stores nothing and writes one redacted, rate-limited log line per distinct violation (directive, blocked origin, page path). Astro no longer inlines scripts or stylesheets. The Privacy Policy describes the reports, and the README explains how to read them and when to enforce (#7)

## [1.22.28] - 2026-10-11

### Security

- Privileged changes now need a password confirmed in the last 15 minutes: changing a staff role, adding an account, setting someone's password, deleting an account, changing another user's email or verified status, and linking or unlinking a sign-in method. A stale session is sent to the new `/reauth` page (password, or a linked provider for password-less accounts) and then back to the page, with nothing changed. Signing in with a password or provider counts as a confirmation. When a role change opens admin sections a person didn't have, all of their sessions are signed out, and the audit log records it; removing access takes effect on the next request. Choosing a password (registration, reset, change, or admin set/create) now refuses easily guessed values such as repeats, keyboard or number runs, and passwords built from the site name or the person's name or email; the 12-character minimum is unchanged and existing passwords keep working. Migration `0025_session_reauth.sql` stores the confirmation time per session. `npm run test:fresh-auth` covers it (#46)

## [1.22.27] - 2026-10-11

### Fixed

- Small controls meet the WCAG 2.2 target-size minimum (24×24 CSS pixels): footer links, comment Reply/Report toggles and sort links, events month navigation and "Past events", the admin "View site" link, and a size floor on vote buttons. At 320 pixels wide (the equivalent of 400% zoom), the Turnstile check switches to its compact size so /account and the public forms no longer scroll sideways, and the media upload form and picker fit their containers. Text-only ads grow with enlarged text instead of clipping it, while image ads keep their reserved height (#25)

## [1.22.26] - 2026-10-11

### Fixed

- A Contact, Submit news, Advertise, or Report an inaccuracy submission over its hourly allowance now returns to the form with an explanation and the reader's text restored, instead of a bare "Too many requests" page. Talk votes and reports still answer `429` (follow-up to #11)

## [1.22.25] - 2026-10-11

### Fixed

- Every media library image now needs an editorial decision about its text alternative: meaningful alt text, or an explicit "This image is decorative" choice (rendered with an empty alt). Placeholder alt text such as "photo" or a file name is refused. Existing images with empty alt text are not treated as decorative; the library flags them with a "Needs alt text" badge and a filter (`/admin/media?alt=missing`), and editing one requires the decision first. Decorative changes are recorded in the media audit log. Uploaded ad banners are stored in the library as "Advertisement from <business>". Migration `0023_media_decorative.sql` adds the `decorative` column; `npm run test:media-alt` covers the rules (#24)

## [1.22.24] - 2026-10-11

### Fixed

- The Contact, Submit news, Advertise, and Report an inaccuracy forms now name each problem: an error summary at the top of the form takes focus and links to each invalid field, and each field gets its own message with `aria-invalid` and `aria-describedby`. The same summary appears without JavaScript after a server-side check. What a reader typed is kept in the browser tab's session storage and restored if the form comes back with an error; it never goes into a URL, a log, or our database. Turnstile now announces when the human check expires, times out, fails, or can't load, and the sign-in, registration, password, and account forms recover from network failures with a clear message instead of a stuck button. The Privacy Policy describes the browser-side drafts (#23)

## [1.22.23] - 2026-10-11

### Security

- Public writes now have per-client quotas: the Contact, Submit news, and Advertise forms share 10 submissions an hour, inaccuracy reports allow 10 an hour, and votes 60 a minute. Signed-in readers count by account and signed-out visitors by a keyed hash of their address (IPv6 by /64), stored briefly in `auth_rate_limits`; a limited request gets a plain `429` with `Retry-After`. Talk discussion, comment, and report limits are now checked inside the insert itself, so concurrent requests can no longer slip past them. Migration `0024_report_rate_index.sql` adds an index for the report check. The Privacy Policy describes the posting limits, and `npm run test:quotas` covers them, including concurrent requests (#11)

## [1.22.22] - 2026-10-11

### Security

- Refreshed dependencies: Better Auth 1.7.7 (fixes Magic Link and OAuth Proxy issues in plugins this site does not enable), Astro 7.3.8, @astrojs/cloudflare 14.3.4, @lucide/astro 1.55.0, and marked 18.1.0. The lockfile already resolved Undici 7.29.1 and source-map-js 1.2.2; `npm audit` reports no vulnerabilities. Dependabot now opens one grouped minor/patch npm pull request a week, and `npm run audit` runs an on-demand audit outside the build (#14)

## [1.22.21] - 2026-10-11

### Changed

- Page views from signed-in staff now tell Google Analytics they are internal traffic (`traffic_type: 'internal'`), so the GA "Internal Traffic" data filter can exclude newsroom visits without relying on IP addresses. Reader visits are unchanged; the Privacy Policy notes the exclusion (#56)

## [1.22.20] - 2026-10-10

### Fixed

- Discussion comments are ordered and paged in SQL (with an id tie-breaker), and only the replies under the current page are loaded, so large discussions no longer silently drop their newest comments past a 5,000-row cap. Media-library pagination accepts only whole-number pages from 0 to 1000: the picker API answers 400 for malformed pages and the media page falls back to page 1. `npm run test:forum-pagination` covers both (#55)

## [1.22.19] - 2026-10-10

### Fixed

- Announce status changes to screen readers: Copy link confirms "Link copied to clipboard," the comment-report confirmation is a status message, and the media picker announces concise loading, result-count, no-match, and failure summaries instead of reading whole image grids. A failed media-library load now shows a visible error with a Retry button. Vote buttons already expose their state with `aria-pressed` (#22)

## [1.22.18] - 2026-10-10

### Security

- Send `Strict-Transport-Security: max-age=31536000` on every response so browsers use HTTPS for a year after their first visit. Cloudflare already redirects `http://` and `www` to the HTTPS apex; `includeSubDomains` and `preload` are deliberately off until every subdomain is confirmed HTTPS-ready (#12)

## [1.22.17] - 2026-10-10

### Security

- Authentication rate limits are now enforced in production and shared by every Worker: counters live in a new D1 table (`auth_rate_limits`, migration 0022), keyed by client IP (`cf-connecting-ip`, IPv6 grouped by /64) and auth path, and updated with a single atomic upsert so concurrent requests cannot slip past the limit. Better Auth previously enabled limits only when `NODE_ENV` was `production`, which Workers does not set. Limits count by IP, never by account, so nobody can lock another person out. The scheduled Worker deletes counters after an hour, and the Privacy Policy describes the new sign-in protection (#3)

### Fixed

- `npm run test:auth` loads the response-header module the middleware imports since 1.22.14

## [1.22.16] - 2026-10-10

### Security

- Public form bot checks (Submit news, Contact, Advertise, Report an inaccuracy) now time out after 4 seconds and fail closed: a Turnstile outage, HTTP error, or unreadable response shows a "try again in a moment" message, and nothing is stored or emailed. In production the Turnstile response must also match the site hostname and the form's action (`TURNSTILE_EXPECTED_HOSTNAMES` in `wrangler.jsonc`; set it empty in `.dev.vars` for local development) (#10)

## [1.22.15] - 2026-10-10

### Security

- Bundle the story editor (EasyMDE 2.21.0, pinned) and its stylesheet as same-origin assets instead of loading them from jsDelivr on staff pages, and replace its Font Awesome CDN icons with Lucide, so the editor loads no third-party script, style, or font (#8)

## [1.22.14] - 2026-10-10

### Security

- Send `Cache-Control: private, no-store` on account, admin, business, API, and sign-in/registration/password pages, on any response that sets a cookie, and on every page rendered for a signed-in reader, so personalized responses can never enter a shared cache. Media, feeds, sitemaps, and calendar files keep their public caching, and anonymous public pages are unchanged. `npm run test:headers` covers the policy (#13)

## [1.22.13] - 2026-10-10

### Fixed

- The media picker's Media library and Upload new tabs follow the WAI-ARIA tabs pattern: only the selected tab is in the Tab order, Arrow keys, Home, and End switch tabs, and each tab is associated with a labelled panel (#21)

## [1.22.12] - 2026-10-10

### Security

- Opening a news tip no longer marks it reviewed; navigation or link prefetch leaves its status unchanged. Editors mark an unread tip reviewed with an explicit "Mark reviewed" button, and review and decline actions are now recorded in the admin audit log without tip text, names, or emails. Repeated clicks are harmless no-ops (#53)

## [1.22.11] - 2026-10-10

### Fixed

- Darken form-field borders (`--field`) to at least 3:1 against white and the page backgrounds, and replace the low-contrast amber focus outline with a dark two-tone ring (dark outline plus white halo) that stays visible on both light and dark surfaces (#20)

## [1.22.10] - 2026-10-10

### Security

- Update locked dependencies with `npm audit fix` (no forced upgrades): sharp 0.35.4 to 0.35.5 (GHSA-wq5f-xc86-pv6w), plus undici, source-map-js, workerd, and related tooling. `npm audit --omit=dev` now reports no vulnerabilities (#5)

## [1.22.9] - 2026-10-10

### Fixed

- Give the enhanced story editor input an accessible name ("Story") and associate the Markdown instructions with it, so screen readers no longer announce an unnamed textbox once EasyMDE replaces the labeled textarea (#19)

## [1.22.8] - 2026-10-10

### Security

- Read form and beacon request bodies through a streaming byte limit before parsing: 256 KB for ordinary forms, 1 MB for story forms, and file size plus 256 KB for uploads. Oversized bodies get 413, non-form content types 415, and malformed multipart 400, with no database or email work done (#4)

### Added

- `npm run test:body` regression tests for the bounded body readers

## [1.22.7] - 2026-10-10

### Security

- Validate the sign-in return URL by parsed origin, so values such as `/\example.com` no longer redirect off the site after sign-in; unsafe values fall back to the account page (#6)

## [1.22.6] - 2026-10-10

### Added

- Publish `NewsArticle` structured data on story pages with headline, publication and modification dates, author and profile link, publisher, canonical URL, and lead image when available (#30)

### Changed

- Give the homepage a descriptive title, "Sandusky & Firelands Local News" (#31)

## [1.22.5] - 2026-10-10

### Added

- Editorial import and production sync utilities for the Oct. 10 stories, licensed photos and events, with content preservation, image checksum checks, discussion links and audited Facebook queuing

### Changed

- Expand the news sources guide with Army Corps and Lakeside sources, potential library and Marblehead venue leads, and guidance for verifying event details and photo licenses
- Document the local review and production publication workflow, including featuring stories with lead photos and verifying live pages before releasing the Facebook queue

## [1.22.4] - 2026-10-10

### Fixed

- Sign accounts out everywhere after a successful password reset so existing account, business, and admin sessions cannot survive account recovery (#2)

### Changed

- Track outstanding work in GitHub Issues and organize dated reporting and publication records in the separate project library

### Added

- Isolated password-reset regressions covering session revocation, protected page access, expired and reused links, and fresh sign-in

## [1.22.3] - 2026-10-10

### Added

- Talk starter scripts: `scripts/seed-talk-starter.sql` loads five fictional proof-of-concept community discussions, story comments, and up- and downvotes; `scripts/clear-talk-starter.sql` removes them while keeping threads with later reader comments
- Editorial review notes for Oct. 7–9, 2026, now retained in the separate [project library](../../Projects/firelands-current/editorial/)

### Changed

- News sources guide: add parishes, sheriff fingerprinting fees, Huron and Oak Harbor sources, Port Clinton, Sandusky County Soil and Water, the Sandusky County Visitors Bureau, Pipe Creek and Halloween contest pages, and the X accounts Firelands Current follows

## [1.22.2] - 2026-10-09

### Fixed

- Add a visible-on-focus skip link to public and admin pages so keyboard users can bypass navigation and header advertising and move directly into main content

## [1.22.1] - 2026-10-09

### Fixed

- Allow multiple featured stories and randomly choose a published one as the homepage lead on each request
- Keep Latest in publication-date order, excluding the selected lead
- Save edits to published stories without colliding with their existing Facebook queue entries

## [1.22.0] - 2026-10-09

### Added

- Calendar view on the Events page: a List / Calendar toggle shows a month at a time, Sunday to Saturday, with month-to-month navigation and the same category and community filters as the list
- Multi-day events appear on every day they run, marked "Continues" after the first day; busy days show four events with the rest behind "+N more"
- On phones the month becomes a list of the days that have events, with every event shown

## [1.21.5] - 2026-10-09

### Fixed

- Place the front-page rectangle ad below the Latest stories in the right column
- Show the homepage lead photo's caption and credit, with a link to its story for photo and license details

## [1.21.4] - 2026-10-09

### Fixed

- Count an ad click only when a reader's browser marks the link as they act on it, so link scanners that fetch every URL on a page no longer inflate clicks and click-through rates
- Count the impression when a reader clicks an ad before it has been on screen for a full second

### Changed

- Cleared all ad impression and click stats recorded before this fix

## [1.21.3] - 2026-10-09

### Fixed

- Declare canonical URLs for public pages, removing tracking parameters while preserving content filters, profile tabs, and pagination
- Keep sign-in, registration, password, account, and business portal pages out of search results and exclude them from Google Analytics
- Prevent local production previews and alternate deployment URLs from reporting Google Analytics traffic

### Changed

- Explain Analytics exclusions, URL redaction, and data retention in the Privacy Policy and operator documentation

## [1.21.2] - 2026-10-06

### Added

- Readers can report an inaccuracy from every story and event page. The form at `/report-inaccuracy` is protected by Turnstile and a honeypot, and each report is stored and emailed to `news@firelandscurrent.com`
- Corrections queue at `/admin/corrections` for admins and editors, with status filters, a detail page linking to the live page and its editor, and Mark corrected, Decline, and Reopen actions that record who resolved each report
- Dashboard count of open corrections, and a banner on a story's or event's edit page listing open reports against it

### Changed

- Explain inaccuracy reports in the Privacy Policy and document the corrections queue and its regression checks
- Add `noindex` support to the public layout; the report page is excluded from search and from ads

## [1.21.1] - 2026-10-06

### Fixed

- Add a separate organizer website field to the event editor, public event pages, and search-engine structured data to address missing organizer URL warnings

### Changed

- Document public organizer websites, migration requirements, and event regression checks
- Expand the newsroom source guide and retain the Oct. 5–6 editorial review records

## [1.21.0] - 2026-10-04

### Added

- Advertising inquiry form on `/advertise` emails `ads@firelandscurrent.com`, with the visitor's email in Reply-To, field validation, Turnstile protection, and a direct email link

### Fixed

- Advertising and Contact forms show an error when email sending fails; news tips remain accepted after being saved for newsroom review
- Keep display ads off the advertising inquiry page

### Changed

- Explain advertising inquiry handling in the Privacy Policy and document isolated inbox regression checks
- Update the newsroom source guide with school, council, food-assistance, and community-event sources

## [1.20.6] - 2026-10-03

### Fixed

- Add verified ticket offers and performer details to event pages and search-engine structured data, with optional editor fields for admission price, purchase URL, availability, and performer type
- Keep unknown event details omitted and stop treating an event details link as the organizer's website

### Changed

- Document recommended event fields, public event data, and isolated regression checks

## [1.20.5] - 2026-10-03

### Fixed

- Story editor previews and live side-by-side views use the published-story renderer, keeping raw HTML inert and blocking external images while preserving media-library photos, captions, and credits
- Preview requests require newsroom access, enforce request limits, and prevent caching; failed or stale requests cannot fall back to unsafe browser rendering

### Changed

- Document preview processing in the Privacy Policy, editor guidance, and agent instructions, with isolated regression checks
- Clarify account-linked story attribution and update regional reporting sources

## [1.20.4] - 2026-10-02

### Fixed

- Center the social preview masthead with equal side padding and remove the source logo's unused canvas space; version the image URL so Facebook can fetch the corrected placement

## [1.20.3] - 2026-10-02

### Fixed

- Social previews use the Firelands Current masthead when a page has no lead photo, preventing Facebook from selecting an advertisement as the story image

## [1.20.2] - 2026-10-02

### Fixed

- Use the supported manual redirect mode for Facebook requests on Cloudflare Workers; a runtime regression check verifies both identity and publishing requests preserve redirect protection

## [1.20.1] - 2026-10-02

### Fixed

- Facebook connection warnings include safe HTTP status and API error codes so operators can diagnose a rejected token without exposing credentials or raw Meta error messages

## [1.20.0] - 2026-10-02

### Added

- Facebook Page publishing records every published story in a database queue, checks for missed entries every five minutes, verifies the Page token's identity, and prevents overlapping runs from sending the same story
- Editors can review the archive, record existing Page posts, and retry confirmed missing stories at `/admin/facebook`; dashboard warnings flag posting errors, missed checks, and token expiry
- Isolated regression checks cover migrations, drafts, duplicate prevention, rate-limit retries, ambiguous responses, credential expiry, and staff audit records

### Changed

- A custom Worker entrypoint preserves Astro web handling and adds the scheduled publisher; production posting is enabled after the database migration and Page token setup
- The Privacy Policy explains sending public news to Meta and storing Page authorization and delivery records; the README documents deployment, archive review, and token renewal

## [1.19.0] - 2026-10-02

### Added

- Readers can update their display name and request a verified email-address change from their account page; email changes require a recent sign-in and a Turnstile check
- Public profiles group each person's published articles, visible Talk of the Town topics, and visible replies in paginated tabs; bylines and forum names link to these profiles
- The news editor can assign an author account or retain a guest byline; linked bylines follow display-name changes while profile URLs stay stable
- Regression checks cover profile visibility, pagination, authorship, account deletion, and account editing without changing the working database or sending email

### Changed

- Migration `0017` attributes the existing story archive to JD's account (`jd@orboro.net`), preserving story URLs and publication dates
- The Privacy Policy and account verification email explain the new profile and email-change behavior

## [1.18.0] - 2026-10-02

### Added

- A dedicated Google News sitemap at `/news-sitemap.xml` lists up to 1,000 published stories from the last 48 hours with the publication name, language, original publication date, and headline. Older stories remain in the ordinary sitemap
- `robots.txt` advertises both sitemaps so crawlers can discover recent news alongside the rest of the site

## [1.17.1] - 2026-10-02

### Changed

- The news sources guide defines the coverage area: Sandusky and the rest of Erie County in full; Port Clinton, Oak Harbor, Fremont, Clyde, Bellevue, Norwalk, Amherst and Oberlin for significant news; Lorain and Elyria only when a story affects the Sandusky area
- The guide lists promising city, township, county, school, health and Lake Erie sources across that area, noting which post regularly, which are stale or hard to read, and which have RSS feeds, plus the official Facebook Pages for local governments, police, fire, health departments and schools

## [1.17.0] - 2026-10-02

### Added

- On phones the main navigation folds into a Menu button in the masthead, so every link, including Sign in and the Newsroom, fits without wrapping or being cut off. The date is hidden on phones to make room

## [1.16.2] - 2026-10-01

### Added

- Events have an optional Hours field for events whose hours differ by day; the event page shows it in full and listings say "Hours vary" instead of "All day"

## [1.16.1] - 2026-10-01

### Changed

- The news sources guide adds the Erie County Health Department, City of Huron, Erie County Board of Elections, and the city and police Facebook pages, with notes on reading each one, plus guidance on confirming events found through Facebook

## [1.16.0] - 2026-09-29

### Changed

- New visual design across the site: a dark masthead with a narrow wordmark and today's date, a cool light page, narrow Archivo headlines, and Newsreader for story text, summaries and comments
- Story and event labels lead with the community, followed by the section or category, in sentence case
- The homepage's Coming up block shows each event under a large date number in a full-width tinted band; the events calendar marks each day the same way, with today highlighted
- Talk of the Town lists each discussion with its comment count first
- News, events and Talk of the Town filters are tabs that scroll sideways on phones; the current section is underlined in the main navigation
- The footer is reorganized into a link grid; the Home navigation link is gone (the wordmark goes home)
- The admin panel and business dashboards use the same colors and type as the public site, with sentence-case labels
- The built-in "Advertise with us" ad uses the new colors

### Fixed

- Banner upload fields on the ad form no longer overlap when library image names are long

## [1.15.0] - 2026-09-28

### Added

- News tips are saved for editors to review, mark reviewed, decline, or turn into a story; submitters can request a byline, and signed-in tips link to the submitter's account
- Submit news is now a main navigation item

## [1.14.1] - 2026-09-28

### Changed

- Standardized admin inputs, selects, textareas, and buttons with consistent sizing and focus styling

## [1.14.0] - 2026-09-28

### Added

- The homepage has a block for each news section (Local News, Government, Business, Schools, Community, Outdoors) showing its three newest headlines, with a link to the full section. Sections with no stories are hidden

### Changed

- The homepage rail ad now sits under the lead story, so the lead and the newest-stories list end at about the same height

## [1.13.0] - 2026-09-28

### Added

- Share buttons (Facebook, X, LinkedIn, Reddit, email, copy link) above and below every story
- RSS feed at `/rss.xml` (with `/feed` and `/rss` redirects) and JSON Feed at `/feed.json`, each optionally filtered with `?section=`; pages advertise them for feed-reader auto-discovery and the footer links the RSS feed. Opened in a browser, the RSS feed shows as a readable page

## [1.12.0] - 2026-09-28

### Added

- Facebook and X links in the site footer

## [1.11.0] - 2026-09-28

### Added

- Terms of Service at `/terms`, linked from the site footer and the registration page. It covers accounts, community posting and moderation, advertising, and the limits of our liability

## [1.10.3] - 2026-09-28

### Added

- The Privacy Policy has a "How to delete your data" section, including steps for people who signed in with Facebook, Google, Apple, or Microsoft

### Fixed

- The account page names sign-in methods properly ("Facebook") instead of showing the raw provider id

## [1.10.2] - 2026-09-28

### Fixed

- Linking Facebook from the account page now works. Facebook never confirms email addresses, so the link was refused without any message
- A failed sign-in method link now shows an explanation on the account page instead of disappearing

## [1.10.1] - 2026-09-28

### Added

- Sign-in and sign-up buttons for Google, Facebook, Apple, and Microsoft now show each provider's logo

### Changed

- A failed social sign-in returns to the sign-in page with a plain explanation instead of a raw error page. When the email address already belongs to an account, it says to sign in first and link the provider from the account page

## [1.10.0] - 2026-09-28

### Added

- Email verification: new email/password accounts get a confirmation link by email and cannot sign in until they use it. Signing in before confirming sends a fresh link
- Password reset by email (`/forgot-password` and `/reset-password`)
- Cloudflare Turnstile on sign-up, password-reset, and resend requests
- Microsoft sign-in, and Google, Facebook, Apple, and Microsoft buttons on the registration page

### Changed

- Existing accounts and accounts created by administrators are marked verified (migration `0014`), so nobody is locked out

## [1.9.0] - 2026-09-28

### Added

- Editors can feature a story on the front page with a **Feature on the front page** checkbox in the story editor. The featured story is the large lead until another story is featured, and only one story is featured at a time. With none featured, the newest story still leads. The admin story list marks the featured story
- Five new Sandusky stories from City of Sandusky announcements, each linking to its source

### Changed

- The large front-page story has a **Read the full story** link under its byline

### Database

- Migration `0013_featured_story.sql` adds a `featured` flag to `news_articles`. Apply it before deploying

## [1.8.0] - 2026-09-28

### Added

- A Submit news form at `/submit-news` for tips, story ideas, and announcements, emailed to the newsroom at news@firelandscurrent.com
- A Contact form at `/contact` for general questions and feedback, emailed to contact@firelandscurrent.com
- Both forms are open to everyone, protected by Cloudflare Turnstile, and linked from the footer and the sitemap. Replies go straight to the sender

### Changed

- The privacy policy describes the contact forms and Turnstile

## [1.7.0] - 2026-09-28

### Added

- Every news story now has a Talk of the Town discussion, created automatically when the story is published (and for stories already published). Readers can comment at the bottom of the story, and the same comments appear on the discussion's page in Talk of the Town
- Upvotes and downvotes on discussions and comments, with comments sortable by Top, Newest, or Oldest
- Every event now has a Talk of the Town discussion too, created when it is published or cancelled (and for existing events), with comments at the bottom of the event page
- Talk of the Town filters: All, Stories, Events, and Community discussions
- Nested replies: readers can reply to any comment, up to five levels deep, and new replies land in place. A hidden comment shows as removed while replies to it remain
- Story discussions are marked in the Talk of the Town list and show points and comment counts

### Changed

- Discussion pages now open on the first page of top comments instead of the last page of replies, and page through 50 top-level comments at a time
- The privacy policy mentions comments on stories and votes

## [1.6.1] - 2026-09-28

### Fixed

- The footer now stays at the bottom of the window on short pages instead of floating partway up

## [1.6.0] - 2026-09-27

### Added

- Local events calendar at `/events`: upcoming events grouped by day, filters by category and community, and past events
- Event pages with date, time, venue and map link, cost, organizer, an optional image and details, and an **Add to calendar** download (`.ics`)
- schema.org `Event` data on event pages, so search engines can show events in their own listings
- *Coming up* on the front page, showing the next four events, and an Events link in the site navigation
- Events admin at `/admin/events` for administrators and editors: create, edit, cancel, and duplicate events for another date; administrators can delete
- Upcoming events on the admin dashboard, and published events in the sitemap
- D1 migration 0009, which adds the `events` table
- Demo events in `scripts/seed-demo.sql`

### Changed

- Media library images used by events count as in use and can't be deleted; an image's page lists those events

## [1.5.0] - 2026-09-27

### Added

- Privacy Policy at `/privacy`, describing what the site collects and shares: accounts, sign-in sessions, Talk of the Town posts, Google Analytics, Cloudflare Web Analytics, hosting logs, and ad counts. It's linked from the footer and the registration page and listed in the sitemap
- Footer credit: Firelands Current is owned and operated by Stone Dragon Media, LLC, linked to stonedragonmedia.com
- `LICENSE.md`: the source is published for transparency and security review; commercial use, public deployment, and redistribution need written permission from Stone Dragon Media, LLC

## [1.4.0] - 2026-09-27

### Added

- Google Analytics (GA4) on every page outside the admin panel, using the measurement ID in `GA_MEASUREMENT_ID` in `wrangler.jsonc`; the tag loads only in production builds, so local development isn't counted

## [1.3.0] - 2026-09-27

### Added

- XML sitemap at `/sitemap.xml` for search engines such as Google Search Console: the front page, news and its sections, Talk of the Town, the advertising page, every published story, and every visible discussion, with last-updated dates for stories and discussions
- `/robots.txt` pointing crawlers to the sitemap and keeping them out of the admin panel, account and business dashboard pages, the API, and ad click links

## [1.2.0] - 2026-09-27

### Added

- Media library at `/admin/media` for administrators and editors: every story and ad image, with a required credit, alt text, caption, and a staff-only source and permission note
- Upload images from the library or from the story editor's picture button; dragging or pasting an image into a story opens the same credited upload form
- Photos are resized to at most 2,000 pixels and re-saved in the browser before upload, which removes location data from phone photos
- Lead images for stories, shown above the story, on the front page, in the news list, and as the social media preview image
- Social media preview tags (Open Graph and Twitter cards) on every page
- Each image's page lists the stories and ads that use it; images in use can't be deleted
- Media uploads, edits, and deletions appear in the admin audit log
- D1 migration 0008, which moves existing ad banners into the library

### Changed

- Story images on a line of their own show as figures with caption and credit; stories only show library images, and images linked from other sites show as their alt text
- Ad banner sizes take a new upload credited to the advertiser, or an existing library image of the right size

### Fixed

- Readers stay signed in while they keep visiting: the refreshed session cookie now reaches the browser, instead of every sign-in expiring seven days after it began

## [1.1.0] - 2026-09-27

### Added

- Lucide icons throughout the admin panel (`@lucide/astro`, server-rendered inline SVG): sidebar sections, action buttons, card headings, dashboard and ad stat tiles, back links, and pagination
- Every admin section requires a sidebar icon, enforced by the type checker

### Changed

- Admin buttons align an icon and label side by side
- The "View site" link in the admin header stays on one line on phones

## [1.0.0] - 2026-09-27

First versioned release.

### Added

- Reader accounts with Better Auth: email/password, optional Google, Facebook, and Apple sign-in, and linked sign-in methods
- Talk of the Town discussions with threads, replies, member reports, and rate limits
- News section pages, story pages, and the latest stories on the homepage, with Markdown story text
- Admin panel at `/admin` gated by staff roles (admin, editor, moderator): dashboard, News editor, Talk of the Town moderation, users, businesses, and ads
- User management: suspensions, session sign-out, password resets by staff, account creation and deletion, and an audit log
- Businesses with members, owner/member roles, and archiving
- Ads: placements, targeting, schedules, impression caps, signed impression and click tracking, R2-hosted banner images, and a read-only business dashboard at `/business`
- D1 migrations 0001–0007 and local demo seed scripts
- Canonical-domain redirect from `www.firelandscurrent.com`

[1.1.0]: https://github.com/jmusick/FirelandsCurrent/releases/tag/v1.1.0
[1.0.0]: https://github.com/jmusick/FirelandsCurrent/releases/tag/v1.0.0
