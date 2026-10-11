# Firelands Current

An independent local newspaper for Sandusky, Ohio and the Firelands, built with Astro on Cloudflare Workers and live at [firelandscurrent.com](https://firelandscurrent.com). It publishes news and a local events calendar, hosts reader discussions in **Talk of the Town**, and sells display ads to local businesses.

Historical external-service checks and unresolved setup observations are recorded in [docs/operations-history.md](docs/operations-history.md); dated observations there do not certify current settings.

Outstanding work is tracked in [GitHub Issues](https://github.com/jmusick/firelands-current/issues). The [October 10 backlog migration](https://github.com/jmusick/firelands-current/issues/1) preserves the former TODO.md audit context and links to each migrated item. Ask Codex to review, create, update, or implement an issue by number; the source documentation remains the reference for current behavior and implementation guidance.

Git tracks application code, migrations, demo fixtures, tests, utility scripts, shared launch settings, and source documentation. Local environment values, build/runtime output, database exports, temporary reports, and Python caches are ignored. Keep reporting records and artwork in the project library described below. `.gitignore` prevents new files from being added; it does not remove files already committed or erase Git history.

## Publication working records

Dated reporting reviews, source evidence, content snapshots, import SQL, and publication screenshots live in the separate [project library](../../Projects/firelands-current/README.md), under `editorial/<date>/` or `image-research/<date>/publication/`. These records describe publication work rather than site implementation. The editorial rules remain in [docs/news-sources.md](docs/news-sources.md).

The associated October 2–10 editorial utilities live in `scripts/editorial/<date>/`; October 9 image utilities live in `scripts/image-publication/2026-10-09/`; campaign utilities live in `scripts/ad-creatives/<campaign>/`. The shared JavaScript `scripts/project-library.mjs` and Python `scripts/project_library.py` helpers resolve the library relative to the source checkout, defaulting to `../../Projects/firelands-current/` from the repository root. Set `FIRELANDS_PROJECT_DIR` to an absolute library path for a different checkout layout. Run utilities from the repository root so Wrangler configuration, dependencies, and the local database resolve correctly. Python artwork rendering also requires Pillow; JavaScript image export uses the installed Sharp dependency. The dated utilities retain their original operations and assumptions; production commands still require deliberate authorization.

The October 10 utility, `node scripts/editorial/2026-10-10/import.mjs --apply-local`, imports its project-library package once, using the normal media validator and upload audit. It preserves existing content and holds new Facebook outbox records in review. It has no production mode. Use `--verify-local` to check saved rows and R2 checksums, or `--verify-http` with the dev server running to check story/event pages, discussion links and image responses. The dredging photo uses an uncropped body figure to respect its CC BY-ND license; the other two file photos are lead images.

After publisher authorization, `node scripts/editorial/2026-10-10/sync.mjs --prepare` checks production conflicts and author accounts, exports validated local image bytes, and features the two new stories with lead photos locally. Run `--publish` to upload and verify production R2 objects and insert the approved stories, events, media audits and discussions, holding Facebook entries in review until live-page checks pass. Run `--queue` to release the three new stories with audited queue actions, then `--verify` to compare content and counts, verify live pages and image checksums, and record Facebook delivery status. These operations retain publication evidence in the project library and do not deploy Worker code.

For the October artist campaigns, `node scripts/ad-creatives/2026-10-artists/prepare.mjs` rebuilds exports; `node scripts/ad-creatives/2026-10-artists/publish.mjs` validates and prepares publication SQL. Publishing requires the explicit `--publish --local` or `--publish --remote` arguments and authorization for the selected target. Give replacement artwork new media IDs and object keys because existing images have long-lived caching.

## What works now

- Email/password registration, sign-in, sign-out, display-name changes, verified email-address changes, password changes, and password reset by email through Better Auth. New email/password accounts must confirm their address from a link we email before they can sign in; sign-up, reset, and resend requests are protected by Cloudflare Turnstile
- Public profiles at `/profile/<user.id>` group published articles, visible forum topics, and visible replies in paginated tabs. Story bylines and forum names link to profiles; email addresses and account details remain private. Display-name changes appear on linked articles and posts. Hidden discussions, hidden replies, unpublished stories, and draft events stay out of profile activity.
- A stable local `user.id`, with additional OAuth sign-in methods linked through the `account` table
- Optional Google, Facebook, Apple, and Microsoft sign-in and sign-up; buttons appear on `/sign-in` and `/register` only when credentials are configured
- Publicly readable Talk of the Town discussions; signed-in readers can start threads and reply
- Every published story and every published or cancelled event automatically gets a Talk of the Town discussion (created when it is first published, and for existing ones by migrations `0010` and `0012`). Talk of the Town can be filtered to Stories, Events, or Community (reader-started) discussions with `/talk?type=story|event|community`. Its comments appear at the bottom of the story and on the discussion's own page; they are the same comments. The discussion is started by a sign-in-less `newsroom` account, takes its title and summary from the story, and is hidden while the story is unpublished or the event is a draft or a moderator hides it. Deleting a story or event deletes its discussion
- Upvotes and downvotes on discussions and comments (click again to take a vote back), and comments sorted by Top, Newest, or Oldest. Comments are nested: readers reply to any comment, up to five levels deep, and each page shows 50 top-level comments with all their replies. A comment a moderator hides stays as "[removed by a moderator]" while visible replies sit below it
- Rate limits on threads, replies, reports, and votes (see Public-write quotas)
- Member reports, reviewed in the admin panel with hide/dismiss actions
- News: section pages, story pages, and the latest stories on the homepage; story text is Markdown, with lead images and captioned photos from the media library. The coverage area, trusted sources, and editorial rules are in [docs/news-sources.md](docs/news-sources.md)
- Local events calendar at `/events`, as a day-by-day list or a month calendar, with an upcoming-events block on the front page, event pages with an add-to-calendar file, and search-engine event data
- Media library for story, ad and event images, stored in R2, with credits, usage tracking and social-preview images
- Share buttons (Facebook, X, LinkedIn, Reddit, email, copy link) above and below every story; they are plain links, so no third-party scripts load. The footer links the paper's Facebook and X accounts
- Facebook Page delivery through a persistent posting queue, with cron checks, bounded retries for rate limits, and an editor dashboard at `/admin/facebook`. Activation requires the production migration, a Page access token secret, and the posting switch described below
- RSS feed at `/rss.xml` (also `/feed`, `/rss`) and a JSON Feed at `/feed.json`, each with the 30 newest stories (summary, lead image, byline, section). Add `?section=local` (or any section key) for one section. Every page advertises the feed for auto-discovery, and the footer links it
- `/sitemap.xml` listing the main pages, news sections, published stories, published and cancelled events, and visible discussions, and a `/robots.txt` that points to it and keeps crawlers out of admin, account, business, ad-click, and API routes
- `/news-sitemap.xml` listing up to 1,000 newest published stories from the last 48 hours with Google News publication metadata, original publication dates, and headlines. It refreshes after at most five minutes of caching; older stories remain in the ordinary sitemap. Both sitemaps are advertised in `/robots.txt`. Submit the news sitemap in Google Search Console after deploying it; an empty news sitemap is expected when no stories were published in the last two days
- Submit news (`/submit-news`) and Contact (`/contact`) forms, open to anyone. Submit news is linked in the main navigation and footer, Contact in the footer. News tips are stored in D1 and emailed to `news@firelandscurrent.com`; signed-in submitters are linked to their account, and submitters can request a byline if their tip becomes a story. Editors review tips at `/admin/submissions`; opening a tip leaves it unread until an editor presses **Mark reviewed** (a same-origin POST that is repeat-safe and recorded in the audit log without tip text or contact details). Editors can also mark tips reviewed, decline them, or convert them into a story. Contact messages are emailed to `contact@firelandscurrent.com` and are not stored in D1. Both forms use the `EMAIL` Cloudflare Email Sending binding, with the sender in Reply-To. Cloudflare Turnstile (`TURNSTILE_SITE_KEY` var, `TURNSTILE_SECRET_KEY` secret) and a hidden honeypot field filter bots
- Report an inaccuracy: every story and event page links to `/report-inaccuracy?type=news|event&slug=…`, a Turnstile- and honeypot-protected form (open to anyone, `noindex`, no ads) collecting name, email, what is wrong, an optional suggested fix, and an optional source link. Reports are stored in the `corrections` table (migration `0021_corrections.sql`) and emailed to `news@firelandscurrent.com` with a link to the review page. Admins and editors work the queue at `/admin/corrections` (status filters, a detail page with links to the live page and its editor, and Mark corrected / Decline / Reopen with an optional note recording who resolved it). The dashboard shows the open count, and a story's or event's edit page lists open reports against it. Editing the story itself still happens in the normal editor.
- Google Analytics (GA4) on public pages, with the measurement ID set as `GA_MEASUREMENT_ID` in `wrangler.jsonc`; the tag loads only in production builds over HTTPS on the `SITE_URL` origin, so local previews and alternate deployment URLs do not report traffic. It is excluded from sign-in, registration, password, account, and business portal pages. In the GA web stream, keep email redaction on and redact the URL query keys `token`, `code`, `state`, and `email` before collection. Page views from signed-in staff send `traffic_type: 'internal'` so the GA "Internal Traffic" data filter (Admin → Data filters, set to *Active*) excludes them; staff visits while signed out still count
- Public pages declare canonical URLs without tracking or form query parameters, preserving normalized news sections, event filters, discussion types, profile tabs, and pagination. Sign-in, registration, password, account, and business portal pages carry `noindex`; authentication pages remain crawlable so search engines can read that directive
- Advertising inquiries on `/advertise`, open to anyone, use the shared inbox form to email `ads@firelandscurrent.com` with the visitor in Reply-To. The form collects name, email, business or campaign subject, and message; inquiries are not stored in D1. Turnstile and a honeypot filter bots, and the page carries no display ads. Advertising and Contact forms show a send error if Cloudflare rejects the email; news tips remain accepted when stored in D1 even if their notification fails. The existing `EMAIL` binding and onboarded sending domain are required; no new migration or secret is needed
- Form errors on Submit news, Contact, Advertise, and Report an inaccuracy: the browser checks the fields itself (`src/scripts/form-errors.ts`), then shows an error summary that takes focus, with a link to each invalid field, a message under each field linked by `aria-describedby`, and `aria-invalid="true"` on the field. When the server rejects a submission it redirects back with only error codes (`?error=invalid&fields=name,email`, `captcha`, `send`) and the page renders the same summary and messages. The visitor's text stays in the browser: it is copied to `sessionStorage` when the form is submitted and put back only when the page loads with an `error` parameter, then discarded after a successful send or the next normal visit. Message contents never go in a URL, log, or the database. The Turnstile widget is mounted by `src/lib/turnstile-client.ts` (explicit rendering) and announces expired, timed-out, failed, or blocked human checks in a polite status region; the sign-in, sign-up, password-reset, and account forms show a network-failure message and re-enable their submit button when the request cannot reach the server.
- Human checks on the shared inbox forms (Submit news, Contact, Advertise) and Report an inaccuracy call Turnstile with a 4-second timeout and fail closed: a failed or missing token shows "Please complete the human check", while a Cloudflare outage, HTTP error, or unreadable response shows "We could not run the human check right now" so the visitor can retry. Neither case stores or emails the submission. Each widget declares a `data-action` (`inbox` or `corrections`); when `TURNSTILE_EXPECTED_HOSTNAMES` (comma-separated, set in `wrangler.jsonc`) is present, the response must also name one of those hostnames and the form's action. Set it to an empty value in `.dev.vars` (the example file does), because `wrangler.jsonc` vars also apply to local development and Cloudflare's test keys report the hostname `example.com`; an empty value turns both checks off. Sign-up, password-reset, verification, and email-change checks go through Better Auth's captcha plugin and are not covered by this timeout.
- Terms of Service at `/terms`, linked from the footer and the registration page. It covers accounts, community posting and moderation, and advertising, and names Ohio law; have counsel review it before relying on it
- Privacy Policy at `/privacy`, linked from the footer and the registration page. It describes exactly what the site collects (accounts, sessions, posts, Google Analytics, Cloudflare Web Analytics, ad counts), so update it whenever that changes
- Admin panel at `/admin` (dashboard, News editor, news tips, events calendar, media library, Talk of the Town moderation, users, businesses, ads) gated by staff roles
- On phones the main navigation folds into a Menu button in the masthead
- Public and admin pages start with a keyboard-focusable “Skip to main content” link, visible on focus, that bypasses navigation and any header advertising.

## Local setup

Requires Node.js 24 or later.

1. Run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and replace `BETTER_AUTH_SECRET` with a unique, long random value. `.dev.vars` is ignored by Git.
3. Run `npm run db:migrate:local`.
4. Run `npm run dev` and open `http://127.0.0.1:4321`.

The local D1 database persists under `.wrangler/` and is separate from production. The working local database is kept matching production content, so don't load the demo seeds into it; `npm run db:seed:demo` (fictional stories and discussions) and `scripts/seed-ads-demo.sql` are only for a throwaway database. `npm run check` and `npm run build` verify the code.

For the publisher's proof of concept, `scripts/seed-talk-starter.sql` adds five community discussions with 20 comments and 16 comments on four October 2026 news stories, with 34 discussion votes and 80 comment votes from the five participants. Votes include both upvotes and downvotes, without self-votes, so scores and Top sorting use the normal forum behavior. The participants and conversations are fictional and carry no public demo labels; participant accounts have reserved `.invalid` email addresses, no sign-in credentials and no staff roles. This script leaves existing content intact and can be run again without replacing posts. Load locally with `npx wrangler d1 execute DB --local --file scripts/seed-talk-starter.sql`. After publisher approval, the same file can be loaded with `--remote`; pushing code does not transfer database rows. Story comments match discussions by article slug and are skipped if the story or its discussion is missing or unpublished. `scripts/clear-talk-starter.sql` removes the seeded posts and votes, retaining community threads with later reader comments and participants reused elsewhere; run it with the same database target.

Form and beacon endpoints read their bodies with a streaming byte limit before parsing (256 KB for ordinary forms, 1 MB for story forms, file size plus 256 KB for uploads), answering 413 for oversized bodies, 415 for non-form content types, and 400 for malformed data. `npm run test:body` covers the reader with isolated fixtures.

Run `npm run test:headers` for the response-header policy (security headers and the private caching rules below).

Run `npm run test:corrections` for isolated regressions of the inaccuracy report endpoint (origin, bot checks including outages, validation, storage, and notification failures); it simulates Turnstile, email, and the database.

Run `npm run test:forum-pagination` for regressions of discussion paging (stable ordering, newest comments never dropped in discussions over 5,000 comments, replies kept under their parents) and media-library page validation. The admin media API answers 400 for a malformed `page`; the admin media page falls back to page 1.

Run `npm run test:inbox` for isolated inbox regressions covering tip review actions (viewing changes nothing; marking reviewed is audited and repeat-safe), advertising routing, Reply-To, validation, bot checks (including timeouts, HTTP and JSON failures, and hostname/action validation), email failures, and news-tip retention. Email sends and Turnstile responses are simulated; these tests do not send real mail or modify the local database.

If a large layout edit leaves the local page showing stale global styles, restart the dev server to clear Vite's stylesheet cache. Also restart it after running `npm run check`, which can invalidate the dev server's client scripts.

## Staff roles

The admin panel at `/admin` is available to users with a row in `staff_roles`:

| Role | Access |
| --- | --- |
| `admin` | Every admin section, including Users, Businesses, and Ads; can delete stories and events |
| `editor` | News, Facebook, News tips, Corrections, Events, and Media |
| `moderator` | Talk of the Town |

Sections and the roles allowed in each are listed in `src/lib/admin.ts`; a new content area (classifieds, jobs, …) adds an entry there. Once one administrator exists, roles are managed at `/admin/users`. To create the first administrator, register the account, then:

```powershell
npx wrangler d1 execute DB --local --command "INSERT OR REPLACE INTO staff_roles (user_id, role, created_at) SELECT id, 'admin', unixepoch() * 1000 FROM \"user\" WHERE email = 'you@example.com'"
```

Production promotion must be done deliberately against the production D1 database (`--remote`).

## Account profiles and authors

Readers update their display name (1–80 characters), request an email change, and change their password at `/account`. Email changes require a recent session and a Turnstile check; Better Auth sends a one-hour link to the new address and keeps the current address until verification. An address already in use receives no link. Names may be shared; profile URLs use stable account IDs, so changing a name or email does not break links.

Password-reset links expire after one hour and can be used once. A successful reset signs the account out everywhere, including existing account, business, and admin sessions; the person must sign in again with the new password. Requesting a link or submitting an invalid or expired link does not sign anyone out.

Better Auth throttles `/api/auth/*` by client IP address and endpoint: three sign-in, registration, password-change, or email-change requests per 10 seconds, three password-reset or verification emails per minute, and 100 requests per 10 seconds elsewhere; IPv6 addresses count per /64 network. A throttled request gets `429` and the reader sees "Too many requests"; the window does not extend while a client keeps retrying. Counts are kept per address rather than per account, so failing sign-ins against someone's email address cannot lock them out, though people sharing one address (an office or a mobile carrier) share its allowance. The address comes from Cloudflare's `CF-Connecting-IP` header, which visitors cannot set; `X-Forwarded-For` is ignored. Counters live in the D1 table `auth_rate_limits` (migration `0022_auth_rate_limits.sql`), so every Worker isolate enforces the same limit, and each request is counted and decided in one atomic upsert so concurrent requests cannot slip past it. The five-minute cron deletes counters an hour after their window starts. Limits also apply in local development. **Apply migration `0022` to production with `npx wrangler d1 migrations apply DB --remote` before deploying this code**; without the table every auth request fails.

### Public-write quotas

Public writes carry per-client application quotas on top of Turnstile and the honeypot. Every limit is a fixed window, and a client counts as the signed-in account when there is one, otherwise the connecting address from `CF-Connecting-IP` (IPv6 grouped by /64).

| Write | Limit | Over the limit |
| --- | --- | --- |
| Contact, Submit news, and Advertise (shared) | 10 per hour | Back to the form with an "error=rate" message and the reader's draft restored; nothing is stored or emailed |
| Report an inaccuracy | 10 per hour | Same |
| Talk votes (including changing or taking back a vote) | 60 per minute | Plain-text `429` with `Retry-After` |
| New Talk discussions | 5 per hour | Back to the form with the existing "rate" message |
| Talk replies | 3 per minute | Back to the discussion with the existing "rate" message |
| Talk reports | 10 per hour | Plain-text `429` |

The first three are counted in the `auth_rate_limits` table (keys `quota:<name>:<client>`) with the same single-statement upsert Better Auth uses, so every Worker isolate shares one count; `src/lib/quotas.ts` holds the limits. Signed-out clients are keyed by a keyed hash of the address, never the raw address. Submissions that are not sent (honeypot hits, failed human checks, invalid fields) do not use an allowance. If the counter cannot be read, the request is allowed and a `quota_unavailable` event is logged, so a database hiccup does not discard a news tip. Discussions, replies, and reports count the author's recent rows inside the `INSERT` that stores them (`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < limit`, then `meta.changes` is checked), so concurrent requests cannot all pass a stale count. Migration `0024_report_rate_index.sql` adds the index that keeps the report count cheap. These limits are application controls only; Cloudflare WAF and rate-limiting rules are configured outside this repository and have not been reviewed here.

Run `npm run test:quotas` for the limits against an isolated in-memory database with the real migrations and endpoints, including concurrent requests for every limit, per-client separation, IPv6 grouping, forged forwarding headers, window reset, and the unavailable-counter case. No real mail is sent and the working database is untouched.

Run `npm run test:auth` for password-reset and throttling regressions using the real Better Auth handlers and site middleware against an isolated in-memory database. The throttling tests send concurrent requests through separate auth instances, spoofed forwarding headers, and IPv6 addresses. The tests capture reset mail and simulate Turnstile; they do not send real mail or modify the working database.

Run `npm run test:profiles` for regression checks against an isolated in-memory database. These exercise attribution, visibility, pagination, account deletion, and the real Better Auth name-change and email-verification handlers; test mail is captured locally and Turnstile responses are simulated.

In the news editor, choose an **Author account** to link a story to a profile and use that account's current display name as its byline. New stories default to the editor's account. Choose **Guest byline** for contributors without an account; tip conversions requesting credit default to a guest byline. Deleting an author account keeps its stories with the saved text byline and removes the profile link. Automatically created story/event discussions continue to belong to the Newsroom account.

Migration `0017_article_authors.sql` adds the account relationship and assigns all stories present when it runs (including drafts) to the account with `jd@orboro.net`, with the saved byline `JD`. It leaves stories unchanged if that account is missing; verify the account and resulting attribution before deploying. Apply this migration before deploying the profile code.

## Facebook Page publishing

The **Firelands Current Publishing** Meta app (`1640810601082553`) sends news to Page API ID `1342964875571057`. The separate **Firelands Current** app handles reader Facebook sign-in. Use a Page token with `pages_manage_posts`, `pages_read_engagement`, and `pages_show_list`, issued for the publishing app and the correct Page. The current verified token expires December 1, 2026; renew it before then. Business verification alone does not establish ongoing Page access.

Migration `0018_facebook_posts.sql` creates the posting ledger and database triggers. Stories already published when it runs start in **Archive review**, since some may have been shared manually. Editors check the Page and either record the full existing post ID (`pageid_postid`) or queue a missing story. Existing IDs can be retrieved from the Page's `/feed` in Meta's Graph API Explorer. Recording an existing post is a staff assertion that it links to that story; the dashboard does not verify its contents with Meta. Each queue or record action is audited. Queuing is unavailable for drafts or stories already recorded as posted.

After activation, every new published story is queued atomically, including stories inserted directly into D1. Every five minutes, the Worker also scans the full published archive for missing ledger entries, checks that the token can post to the configured Page, and sends up to five queued stories, oldest first. It posts the headline, summary, and canonical story link; Facebook fetches the site's public preview metadata and image; pages without a lead photo use the Firelands Current masthead. Drafts and future-dated stories are held. Editing a story or returning it to published status does not repost it. Deleting or unpublishing a story does not remove its existing Facebook post; editors must handle Facebook corrections separately.

Only explicit rate-limit rejections retry automatically, with exponential delays capped at an hour and at most six attempts. Permission failures need staff attention. Network loss, an unreadable response, server errors, and a Worker interrupted while sending become **Check Facebook**: the post may already exist, so no automatic retry happens. Check the Page, then record its post ID or confirm that it was not posted before queuing it again. Database claims prevent overlapping runs from sending the same queued story.

Deployment steps, after approval:

1. Apply migration `0018` to production with `npx wrangler d1 migrations apply DB --remote` before deploying the new Worker.
2. Store `FACEBOOK_PAGE_ACCESS_TOKEN` using `npx wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN`, supplying the token through the prompt or stdin. Never put it in source, command-line arguments, logs, or `wrangler.jsonc`.
3. Check the publishing app's Meta publishing and access requirements, and verify an approved real story appears for ordinary Facebook readers. Development-mode behavior is not proof of public delivery.
4. Set `FACEBOOK_AUTO_POST_ENABLED` to `"true"` in `wrangler.jsonc`, keeping `FACEBOOK_PAGE_ID`, `FACEBOOK_GRAPH_VERSION`, and the verified token expiry (`FACEBOOK_TOKEN_EXPIRES_AT`, Unix milliseconds) accurate. Publish the release after the migration and secret are in place.
5. Review `/admin/facebook`: resolve the archive, inspect any errors, and confirm the five-minute checks are arriving. A run older than 15 minutes and a token within two weeks of expiry show warnings. These are dashboard warnings; there are no email alerts.

Production posting is enabled in `wrangler.jsonc`; the verified Page token is stored as a Cloudflare secret. Keep `FACEBOOK_AUTO_POST_ENABLED=false` in `.dev.vars`; development must never send stories to the live Page. The publisher also refuses a non-production `SITE_URL`. Renew a token in Meta, verify its app, Page, scopes, and expiry, replace the Cloudflare secret, update the recorded expiry, and requeue permission failures after resolving the cause. A valid token can still be revoked or lose permissions before its recorded expiration.

`npm run test:facebook` exercises migrations, direct imports, duplicate prevention, overlapping runs, drafts, expiry, Page identity checks, retries, ambiguous results, database failures, and audited archive actions against an isolated in-memory database and simulated Meta responses. No live Facebook posts or working story records are created by these tests. `src/worker.ts` delegates web requests to Astro and handles the scheduled publisher; the build preserves both handlers.

## User management

Administrators manage accounts at `/admin/users`: search and filter by role or status, edit name and email, assign staff roles, see sign-in methods, active sessions, and Talk of the Town posts, and:

- **Suspend** for 1, 7, or 30 days or until lifted, optionally hiding all of the person's posts. Sessions are revoked immediately and sign-in is refused by every method while the suspension lasts.
- **Sign out** one session or all of them.
- **Set a password**, for someone who can't use password reset by email. It signs the person out everywhere.
- **Add users** with a temporary password, for example new staff. These accounts start with their email marked verified.
- **Delete** an account and everything it posted, after typing its email address to confirm.
- **Change a staff role** (administrator, editor, moderator, or none). Giving someone access to an admin section they didn't have signs them out of every session, so they sign in again with the new role; see below.

Staff accounts and your own account can't be suspended or deleted; remove the role first. Nobody can change their own role, so there's always at least one administrator. Every change is recorded in `admin_audit_log` and shown at `/admin/users/log` and on each user's page.

### Recent confirmation and role changes

Privileged actions need the signed-in person to have proved who they are within the last **15 minutes** (`REAUTH_WINDOW_MS` in `src/lib/reauth.ts`): typing their password, or finishing a provider sign-in. A session's age is not enough, because it never moves and also covers sessions opened by an emailed link. Signing in with a password, finishing a provider sign-in, and changing your password all open the window, so someone who has just signed in is never asked twice. It does not slide: every privileged action inside the window uses the same confirmation, and the window ends 15 minutes after the proof.

The proof is a row in `session_reauth` (migration `0025_session_reauth.sql`: `session_id` and `reauthenticated_at`, deleted with the session). A session with no row is stale. The sign-in hooks in `src/lib/auth.ts` write it, as does `POST /api/reauth`. **Apply migration `0025` to production with `npx wrangler d1 migrations apply DB --remote` before deploying this code**; without the table nobody can confirm a password, and the admin user pages and endpoints that check freshness return errors.

These need it, and a stale session is redirected to `/reauth?next=<page>&reason=<action>` with nothing changed:

- Admin changes of a staff role, setting a password, deleting an account, adding an account (the add-user page asks up front, before the form is filled in), and changing another account's email address or its verified flag (a way to take over an account through password reset)
- Linking or removing a sign-in method from the account page (`/link-social`, `/unlink-account`, guarded in the Better Auth hook, which answers `403` with code `REAUTH_REQUIRED`; the account page then redirects to `/reauth`). Better Auth's own `/delete-user` is switched off, so there is no self-service account deletion; the hook would gate it if it were enabled.

Suspending, signing people out, hiding posts, and editing a display name stay open to a stale session so a moderator can react to an emergency. The existing 24-hour session-age check for changing your own email address and unlinking a provider remains in addition.

`/reauth` asks for the password and posts to `/api/reauth`, which accepts five attempts per account per 10 minutes (`reauth` in `src/lib/quotas.ts`), then returns `429`. An account with no password, or one that prefers a provider, signs in again with a linked provider instead; the callback records the proof for the new session. `next` is validated as a same-origin path (`safeNext`: no `//`, backslash, control characters, other origins, or `/reauth` itself) and anything else returns to `/account`. `/reauth` carries `noindex`, takes no ads or analytics, and is never cached.

When a role change **gains access** to an admin section the person didn't have (none to any role, or any move to a role with a section the old one lacks, such as editor to moderator for Talk, or moderator to editor for News), every session of that person is deleted in the same batch as the role change, and the `set-role` audit entry records it (for example "None → Editor; signed out 2 sessions"). Taking access away (administrator to editor, or to none) does not sign anyone out: the role is read from the database on every request in `src/middleware.ts` (Better Auth's cookie cache is not enabled), so a demotion applies to the person's very next request. Sessions are not signed out on demotion because nothing about them has gained authority.

### Passwords

Passwords follow NIST SP 800-63B-4 for a password used as the only factor: **15 to 128 characters** (`MIN_PASSWORD` and `MAX_PASSWORD` in `src/lib/password-policy.ts`, the one source for the sign-up, reset, account, and admin forms, their hints, and Better Auth's `minPasswordLength`), no composition rules, no forced rotation, and a blocklist. Anything is allowed, including spaces and Unicode. Existing accounts are not forced to change: only choosing a password (registration, reset, change, admin set or create) is checked, and signing in never is.

The blocklist has two parts, applied identically at Better Auth's `/sign-up/email`, `/change-password`, and `/reset-password` (a before hook) and in the admin Add user and Set password endpoints:

- **Predictable values**, checked locally: one repeated character or short pattern, runs along the digits, the alphabet, or the keyboard rows, and passwords that are little more than the site's name, "password", the person's name, or their email address once those words are removed (fewer than 8 characters left).
- **Known breaches**, using Have I Been Pwned's Pwned Passwords range API (k-anonymity). The Worker sends only the first five characters of the password's SHA-1 hash, with `Add-Padding: true`; the password, the rest of the hash, and any account detail stay here, and the browser never contacts the service. A match with a count above zero refuses the password with the reason shown. This was chosen over Better Auth's `haveIBeenPwned` plugin because the plugin fails closed (an outage answers `500` and blocks sign-up and password reset), whereas here a timeout (3 seconds), an error, or an unreadable reply skips the check and logs `password_blocklist_unavailable`, so recovery keeps working. It was chosen over a bundled list because common-password lists are mostly short passwords the 15-character minimum already excludes, while the breach corpus also catches long leaked passphrases, with no bundle or list upkeep. The Privacy Policy discloses this flow.

Run `npm run test:fresh-auth` for the freshness window, `/reauth` and `next` validation, stale versus fresh privileged actions, session revocation on role changes, the link and unlink guard, and the password rules, through the real Better Auth handlers, site middleware, and admin endpoints against an isolated in-memory database with the Pwned Passwords service simulated.

## Businesses

Administrators group accounts under businesses at `/admin/businesses`: the Firelands Current team (type *In-house*, created by migration 0006 with existing staff as members), advertising clients (*Advertiser*), and anyone else (*Other*). A business has contact details, staff-only notes, and members. Each member is an *Owner* or *Member* and can have a job title. One person can belong to several businesses, for example an agency contact who handles more than one client.

Add members from the business page by account email, or from a user's page. The user list filters by business. Archive former clients instead of deleting them: archived businesses keep their members and history but drop out of pickers. Deleting a business removes only the business and its member list, never the accounts.

Business membership is separate from staff roles. Membership records who someone works for, and staff roles still decide who can use the admin panel. The owner/member distinction is groundwork for a future area where businesses manage their own ads and people.

## Events calendar

Administrators and editors manage the calendar at `/admin/events`. Each event has a title, summary, category, date, optional start and end times (blank start time means all day), an optional hours note for events whose hours differ by day (shown on the event page, with "Hours vary" in listings), an optional last day for events that run several days, a venue, community and address, and optional organizer, cost, link, image from the media library, and Markdown details. On multi-day events the times are the daily hours. Dates and times are Eastern wall-clock values.

Events are *Draft* (staff only), *Published*, or *Cancelled*. Cancelled events stay on the calendar, marked as cancelled, so readers who planned to go can see it; delete (administrators only) is for events entered by mistake. For events that repeat, **Duplicate for another date** on an event's page starts a new draft with the same details. An event's URL comes from its title; a second event with the same title gets its date added.

Readers see upcoming events at `/events`, grouped by day, with filters for category and community and a list of past events. Events that have already started stay under *Today* until their last day. A **Calendar** view (`/events?view=calendar&month=YYYY-MM`) shows a month at a time, Sunday to Saturday, with the same filters; multi-day events appear on each day they run, each day shows four events with the rest behind *+N more*, and on phones the month becomes a list of the days that have events. It covers 2020 through two years ahead. Each event page has a map link, an **Add to calendar** `.ics` file (`/events/<slug>.ics`), and schema.org `Event` data so search engines can list it. The next four events appear under *Coming up* on the front page, and published events are in the sitemap.

The editor also accepts an optional organizer website, performer name and type (person or group), lowest admission price in USD including fees, ticket purchase or registration URL, and ticket availability. These appear on the public page and in its event structured data. The organizer website requires an organizer name and must be an HTTP or HTTPS URL without sign-in credentials; it is retained when duplicating an event. Enter `0` for verified free admission; leave unknown prices blank. Paid admission requires a ticket purchase URL specific to that event. The free-text Cost and More details link are not used to guess ticket offers, and the details link is not treated as the organizer's website. Keep prices and availability current, and review ticket information when duplicating an event.

Search Console may report recommended-field warnings even for valid events. Choose a representative, credited image from the media library, enter the organizer and a verified end time when known, and add performers only when applicable. Unknown details stay omitted; a generic site logo, invented end time, or organizer reused as a performer would misrepresent the event. Existing listings need their new ticket and performer fields filled in where applicable; migration `0019` leaves them blank. After deploying and updating the affected listings, use Google's Rich Results Test before starting Search Console validation.

Apply migration `0020_event_organizer_url.sql` before deploying the organizer website field. It leaves existing websites blank for editors to verify.

`npm run test:events` checks migration compatibility, admission, organizer website and performer saves, public queries, URL and ticket validation, and structured data against an isolated in-memory database. It does not change working event records.

## Media library

Every image on the site lives in the media library at `/admin/media`, open to administrators and editors. Each image has a **credit** (required, shown with it on the site), an **alt text decision** (required, see below), an optional **caption**,, and a staff-only **source & permission** note recording where it came from and who allowed its use. Only use images the paper made or has permission to run.

Every image needs an editorial decision about its text alternative: either **alt text** describing what the image shows, or the **This image is decorative** box, ticked only when the image adds nothing a reader would miss. Saving or uploading is refused with neither, with both, or with alt text that only names the image (“photo”, a file name). Decorative images carry no alt text and render with an empty alternative; everything else renders with its alt text, which a story can override for one use by writing different text between the brackets of the Markdown image. The decision is stored in the `media.decorative` column (migration `0023`). Images uploaded before that migration are not guessed at: those with no alt text stay undecided, show a **Needs alt text** badge in the library, are counted in a notice at the top of `/admin/media`, and can be listed with the **Needs alt text** filter (`/admin/media?alt=missing`). Editing such an image requires making the decision, and the picker marks undecided images. Until then an undecided image renders with an empty alternative, the same as a decorative one. Banner images uploaded with an ad get the alt text “Advertisement from <advertiser>” in the library; the ad itself renders with its own alt text (advertiser and headline). Alt text and decorative changes are recorded in the image's activity log.

Images are uploaded from the library page or straight from the story editor: the picture button opens a picker with the library and an upload form, and dragging or pasting an image into the story opens the same form so it can be credited. Before upload the browser resizes photos to at most 2,000 pixels on the long side and re-saves them, which also removes location data from phone photos; the server strips JPEG metadata again as a backstop. PNG, JPEG, GIF and WebP are accepted, up to 5 MB; SVG is not, since it can carry scripts.

In a story, an image on a line of its own shows as a figure with its caption and credit. Stories can only show library images: an image linked from another site shows as its alt text instead. Each story can also have a **lead image**, shown above the story, with it on the front page and in the news list, and as the preview image when the story is shared on social media.

The story editor's preview and side-by-side view use the same safe renderer as published stories. Raw HTML appears as text, and previews load only existing media-library images, with captions and credits. Previews send the current story text to our Cloudflare-hosted server without saving it and require a connection and a current administrator or editor sign-in. A failed preview shows an error; it does not fall back to rendering untrusted HTML in the browser.

`npm run test:media-alt` checks the alt text decision (required alt text or decorative choice, placeholder rejection, migration `0023` leaving existing rows undecided, and the Needs alt text listing) against an isolated in-memory database.

`npm run test:preview` checks HTML and image restrictions, ordinary Markdown, preview authorization, request limits, and handling of stale or failed preview responses with isolated fixtures. It does not create database records or contact external image hosts.

The front page leads with the newest published story unless an editor ticks **Feature on the front page** in the story editor. Multiple stories can stay featured; each homepage request randomly chooses one published featured story as the large lead, with an equal chance for each. Unticking or unpublishing a story removes it from that selection. If none are featured, the newest published story leads. The four newest other stories fill the Latest list beside it, regardless of their featured status. The lead photo shows its caption and credit, with a link to the story for photo details and any license links. The photo itself is hidden from assistive technology, since the headline and “Photo details” link lead to the story, where the lead image appears with its alt text. The front-page rectangle ad sits below the Latest list in the right column. Below the lead, each news section (Local News, Government, and so on) has its own block with its three newest headlines and a link to the full section; sections with no stories are hidden.

An image’s page lists every story, ad and event that uses it, its details and its history. Images in use can’t be deleted; deleting a story, ad or event leaves its images in the library. Uploads, edits and deletions are recorded in the audit log.

Files are stored in the `MEDIA` R2 bucket under `library/` and served from `/media/…` with long-lived caching, so a replaced image gets a new address rather than changing in place.

## Ads

Ad spaces are defined in `src/lib/ads.ts` (`PLACEMENTS`): a leaderboard under the navigation, front-page rectangle and billboard, a story sidebar, in-story rectangles (only in stories of six or more blocks, never right under a subheading), and sponsored listings in the News and Talk of the Town feeds. Pages ask for an ad by placement. Each page view shows at most one ad per business, prefers ads aimed at the page's news section, and rotates the rest by weight. Unfilled slots show a house ad linking to `/advertise`. Sample ads show only while no ads exist at all. Forms, accounts, dashboards and the admin panel never carry ads.

Administrators manage ads at `/admin/ads`. Each ad belongs to a business and has a creative (headline, text, button, link and colors, plus optional banner images at 728×90, 320×100, 300×250 and 970×250 or double those sizes), targeting (placements, news sections, rotation weight), a schedule (inclusive start and end dates in Eastern time, an optional impression cap) and staff-only price and terms. Ads are *Draft*, *Active* or *Paused*. Active ads show as *Scheduled*, *Running*, *Ended* or *Cap reached* depending on their dates and cap. Changes are recorded in the audit log, and they show on the ad's page and its business's page.

An impression counts when at least half of an ad has been on screen for one second. Clicks go through `/ads/click`, which redirects to the ad's own link; a click counts only when the reader's browser marks the link as they act on it, so link scanners that fetch every URL on a page aren't counted, and a click on an ad not yet on screen for a second also counts its impression. Both carry a signed, single-use token issued when the ad was rendered, so replayed or forged events don't count. Staff browsing the site and known bots aren't counted. Stats are kept per ad, day and placement in `ad_stats`.

Members of a business see its ads at `/business` (linked from `/account`): totals, daily charts, per-placement numbers and each ad's preview. The dashboard is read-only and hides drafts and terms. Administrators can open any business's dashboard with **View as client**.

Banner images come from the media library: each size can take a new upload, which joins the library credited to the advertiser, or an existing library image of the right size. Before the first deploy with ads, create the `MEDIA` bucket with `npx wrangler r2 bucket create firelands-current-media`. Local development uses a local bucket automatically. `scripts/seed-ads-demo.sql` loads fictional advertisers, ads and 45 days of stats into a throwaway database (see Local setup).

## OAuth setup

Set `SITE_URL` to the exact public origin. Add provider credentials as Cloudflare Worker secrets:

| Provider | Required variables | Callback URL |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `{SITE_URL}/api/auth/callback/google` |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `{SITE_URL}/api/auth/callback/facebook` |
| Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `{SITE_URL}/api/auth/callback/microsoft` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | `{SITE_URL}/api/auth/callback/apple` |

Apple requires a paid Apple Developer account and an HTTPS callback origin. The app creates its Apple client-secret JWT from the configured private key. OAuth methods can be linked to an existing account from `/account`; matching email addresses are **not** automatically merged.

## Cloudflare deployment

Astro 7's Cloudflare adapter targets Workers. The `main` branch is connected to Cloudflare Workers Builds with `npm run build` and `npx wrangler deploy`; Cloudflare pulls and deploys each push. The production custom domains, D1 binding, and `SITE_URL=https://firelandscurrent.com` are in `wrangler.jsonc`; `BETTER_AUTH_SECRET` is a Cloudflare secret. Namecheap delegates `firelandscurrent.com` to Cloudflare nameservers. Apply migrations to the production database with `npx wrangler d1 migrations apply DB --remote` when schema changes are deployed.

### HTTPS and HSTS

Cloudflare redirects `http://` requests and `www.firelandscurrent.com` to `https://firelandscurrent.com` with a 308, and the middleware (`src/lib/response-headers.ts`) sends `Strict-Transport-Security: max-age=31536000` on every response so browsers use HTTPS for a year after their first visit. `includeSubDomains` and `preload` are deliberately off: add `includeSubDomains` only after confirming every subdomain serves HTTPS, and treat preload-list submission as a separate, hard-to-reverse decision.

### Response caching

The middleware (`src/lib/response-headers.ts`) sends `Cache-Control: private, no-store` so personal pages never enter a shared cache such as Cloudflare's, and browsers do not store them:

- every response under `/account`, `/admin`, `/business`, and `/api` (including Better Auth's `/api/auth/*`), and the `/sign-in`, `/register`, `/forgot-password`, and `/reset-password` pages
- any response that sets a cookie, such as a sliding session refresh, even on a route that asked for public caching
- every HTML page, and any response without its own caching header, rendered for a signed-in reader

A route's own `no-store` is kept. Media images, feeds, sitemaps, `robots.txt`, and calendar files keep their public caching when they set no cookie, because they are the same for every reader. Anonymous public pages get no caching header: Cloudflare does not cache HTML by default, and the site adds no public HTML caching. Do not add a Cloudflare Cache Rule that caches HTML or ignores origin `Cache-Control` ("Cache Everything" with an overriding Edge TTL); it could serve a signed-out page to signed-in readers or bypass these headers. To check production, compare `curl -sI https://firelandscurrent.com/` with the same request sending a signed-in session cookie.

### Email sending

The forms, verification links, and password-reset links send from `noreply@firelandscurrent.com` through the `send_email` binding (`EMAIL`) in `wrangler.jsonc`; no API token is needed. Onboard the domain once with `npx wrangler email sending enable firelandscurrent.com`, and make sure `news@` and `contact@` exist as real mailboxes or Email Routing addresses that deliver to staff. In `npm run dev`, verification and password-reset links are printed in the server console instead of sent.

### Dependency audits

`.github/dependabot.yml` opens one grouped pull request a week for minor and patch npm updates (majors come separately). Review it, run `npm run check`, `npm run build`, and the `npm run test:*` scripts, and merge to deploy. `npm run audit` runs `npm audit` against the lockfile on demand; it is not part of `npm run build`, so advisories never fail the Cloudflare build. Many advisories hit build-time tooling (Wrangler, Miniflare, Vite) rather than the deployed Worker, so check whether the vulnerable code is reachable before treating one as urgent.

## Versioning

The site follows [Semantic Versioning](https://semver.org/). The version in `package.json` is shown in the site footer, releases are tagged `vX.Y.Z`, and changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Later work

Reader-submitted events, the newsletter, obituaries, jobs, and classifieds are not built yet.

## License

The source is published for transparency and security review, not as open source. You may read, run privately, and research it for non-commercial purposes; commercial use, public deployment, and redistribution need written permission from Stone Dragon Media, LLC. See [LICENSE.md](LICENSE.md).
