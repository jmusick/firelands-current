# Operations: recovery, incidents, and deployment controls

How to get the site back after data loss or a bad deploy, what to do when something goes wrong, and which settings outside this repository to keep checking. The owner is the only operator; every production command here needs the owner's go-ahead at the time it runs. Dated results of checks and drills go in the issue they belong to (for example #15) or [operations-history.md](operations-history.md), not here.

## What can be recovered

| What | Where it lives | Backup | Recovery |
| --- | --- | --- | --- |
| Database: accounts, stories, events, Talk of the Town, tips, ads, audit log | D1 `firelands-current` | D1 Time Travel, automatic: **7 days** on Workers Free (production today), 30 days on Workers Paid | Point-in-time restore, below |
| Images: media library and ad creatives | R2 `firelands-current-media` | **None.** R2 keeps no versions; a deleted or overwritten object is gone | Re-upload from the original files, below |
| Code, migrations, configuration | GitHub `jmusick/firelands-current`, plus each clone | Git history | Redeploy, or roll back a Worker version |
| Secrets (`BETTER_AUTH_SECRET`, `TURNSTILE_SECRET_KEY`, `FACEBOOK_*`, OAuth client secrets, `SECURITY_ALERT_EMAIL`) | Cloudflare Worker secrets | None: Cloudflare can't show them again | Issue new values at each provider and `npx wrangler secret put`; see [Leaked or exposed secret](#leaked-or-exposed-secret) |
| Reporting records, source evidence, original artwork | The project library (README, "Publication working records") | Whatever backs up the owner's machine | Copy back |

The Privacy Policy promises that backup copies of the database are kept for at most 30 days. Time Travel stays inside that on either plan. **Any SQL export of production is a backup copy too**: keep it only as long as the task needs, never in the repository, the project library, `.wrangler/`, or cloud sync, and delete it within 30 days at the latest. `scripts/restore-drill.mjs` deletes its own copies when it finishes.

### Restoring the database

Time Travel restores the production database **in place**: it overwrites the current contents, cancels queries in flight, and cannot clone into a separate database. Restoring also brings back anything deleted since the restore point, including accounts and tips deleted at a reader's request or by the tip retention job.

1. Decide the restore point (UTC) from the incident: the last known-good moment before the damage. Bookmarks older than the plan's window (7 days on Free) can't be restored, even though `time-travel info` will still convert an older timestamp into a bookmark.
2. Record where you are now, so the restore can be undone:
   `npx wrangler d1 time-travel info firelands-current`
   Copy the current bookmark into the incident notes. Then export what you'll need to reapply: at least `admin_audit_log` since the restore point (`npx wrangler d1 export firelands-current --remote --table admin_audit_log --output <temp file outside the repository>`). Delete the file when the incident is closed.
3. Make no admin changes while you restore; anything written between step 2 and the restore is lost with the rest.
4. Restore:
   `npx wrangler d1 time-travel restore firelands-current --timestamp=<Unix seconds or RFC 3339>`
   Wrangler prints the bookmark of the state it replaced; keep it. To undo, restore to that bookmark.
5. Check `npx wrangler d1 migrations list DB --remote`. If the restore point is older than a migration that shipped since, the deployed Worker expects a column the database no longer has: apply the migrations again (`npx wrangler d1 migrations apply DB --remote`) before anything else.
6. Reapply what the restore undid, working from the audit log export: account deletions, tip deletions and anonymizations, takedowns (`thread-hide`, story unpublish or delete), and suspensions. Run nothing from it as SQL; repeat each action in the admin panel so it's audited again. The tip retention job catches up on its own on the next daily run.
7. Check the site: the home page, a story, `/admin/facebook` (the restore can re-queue or forget posts; record any already on the Page instead of re-sending), and the media pages that the restored rows refer to.

If the database itself is lost (deleted, or beyond the Time Travel window), the only copy is an SQL export. Load it in this order, which is what the drill does: the schema without triggers (`--no-data`, everything before the first `CREATE TRIGGER`), then the rows (`--no-schema`), then the triggers, with `PRAGMA defer_foreign_keys=TRUE;` at the top. A single full export does **not** load as written: it creates tables in creation order, and `forum_threads` refers to `events`, which is created later, so the load stops at "no such table: main.events". Loading the triggers before the rows would also queue every story for Facebook again.

### Restoring images

R2 has no backup and no undo, which is why the media library refuses to delete an image a story, event, or ad still uses (`mediaUsage` in `src/lib/media.ts`). If objects are lost:

1. List what the database expects: `node scripts/restore-drill.mjs --remote` reports every `media` row whose object no longer answers at `/media/<key>`.
2. Find each original in the project library (`editorial/<date>/`, `image-research/<date>/`, `ad-creatives/<campaign>/`) or at its source (the row's `source` and `credit`).
3. Upload it again through the media library, which strips metadata and checks the file. That creates a new key; update the story, event, or ad to use the new item, then delete the orphaned row. Never put a file back under its old key by hand: media responses are cached for a year as immutable, and a hand-placed file skips the metadata stripping.

### Rolling back code

Every push to `main` deploys. To undo a bad deploy quickly:

1. `npx wrangler deployments list` shows recent versions; `npx wrangler rollback <version-id>` puts an earlier one back at once.
2. Revert the commit on `main` (`git revert`) and push, or the next push deploys the bad code again.
3. A rollback does not undo migrations. If the bad release shipped one, the older Worker may still work (migrations here only add) or may need a fix forward; check before rolling back further.

## Restore drill

Run it after a schema change that adds a table or a reference between tables, and at least once a quarter:

```
node scripts/restore-drill.mjs            # the local database
node scripts/restore-drill.mjs --remote   # production, read-only; needs the owner's go-ahead
```

It exports the database as schema and rows, loads both in the restore order above into a throwaway local database under the OS temp directory, and checks SQLite's `quick_check`, foreign keys, that every exported table, trigger, and row came back, that every shipped migration is recorded, that published stories read back, and that every `media` row still has its image (the local bucket, or HEAD requests to the live `/media/` URLs with `--remote`). It prints counts and media keys only, never row contents, and deletes the export and the copy however it exits. It cannot test Time Travel itself, which only restores in place; that path is the vendor's, and step 2 above is how you'd undo it. Record the date, mode, counts, and timings in the issue or in `operations-history.md`.

## Incident response

For anything that might expose readers' data, take over an account, change what the site publishes, or take it down. Keep notes as you go: times (UTC), what you saw, what you changed. Those notes are the record; put the summary in a GitHub issue, without personal data, secrets, or exploit details while the issue is still open.

1. **Contain.** Stop the harm first, even if that means losing evidence or uptime: suspend the account, revoke the secret, roll back the deploy, or turn on Cloudflare's "Under Attack" mode (Security, Settings) for a flood.
2. **Assess.** What happened, since when, and what data or accounts it touched. Sources: the audit log at `/admin/users/log` (denied entries included), Workers Logs (`event = auth_event`, `security_alert`, `csp_violation`), `npx wrangler deployments list`, GitHub's security log and the repository's commits, and the Cloudflare account's audit log. Workers Logs keep only a few days; copy what you need into the notes early (redacted).
3. **Fix the cause**, test it, and release it as a patch.
4. **Recover**: data from the sections above, then check the site.
5. **Tell people.** If readers' personal data was or may have been exposed, decide promptly whom to tell and how, and check whether a breach notification law applies (Ohio's is R.C. 1349.19; affected readers elsewhere may be covered by their own state's law). Meta, Google, Apple, and Microsoft also have developer terms requiring notice of incidents that involve data from their sign-in. Get advice when in doubt; telling affected readers plainly what happened and what to do is the default.
6. **Close.** Write down what went wrong and what changes, delete any temporary exports, and update this file.

### Leaked or exposed secret

A secret that reached a commit, a log, a screenshot, or someone else's hands is exposed, even if it was removed straight away. Rotate it; don't argue about whether anyone saw it.

| Secret | Issue a new one at | Then | Side effects |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | `npx wrangler secret put BETTER_AUTH_SECRET` | Everyone is signed out; pending verification and reset links stop working; the auth log hashes, rate-limit counters, and quota counters start over |
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard, Turnstile, the site's widget, rotate secret | `npx wrangler secret put TURNSTILE_SECRET_KEY` | Forms fail between the rotation and the new secret; do both together |
| `FACEBOOK_CLIENT_SECRET` (reader sign-in app) | Meta for Developers, the **Firelands Current** app, App settings, reset | `npx wrangler secret put FACEBOOK_CLIENT_SECRET` | Facebook sign-in fails until the new value is in place |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Revoke it in Meta, issue a new Page token for the **Firelands Current Publishing** app (README, "Facebook Page publishing") | `npx wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN`, update `FACEBOOK_TOKEN_EXPIRES_AT` | Posting pauses until replaced; check `/admin/facebook` |
| Google, Apple, Microsoft OAuth secrets (when configured) | Each provider's developer console | `npx wrangler secret put <NAME>` | That provider's sign-in fails until replaced |
| Cloudflare API token or Wrangler login | Cloudflare dashboard, My Profile, API Tokens: roll or delete; `npx wrangler logout` then `login` | | Workers Builds uses its own token; check it there too |
| GitHub token or SSH key | GitHub, Settings, Developer settings / SSH keys: revoke | `gh auth login` | |

After rotating: run `npm run secrets:scan` to see whether the value is in Git history. If it is, the repository is public, so treat the old value as published; rewriting history doesn't help once it's pushed. Check the service's own logs for use of the old value between the leak and the rotation.

### Account takeover or staff misuse

1. Suspend the account at `/admin/users` (sessions end at once; choose "until lifted"). If it's a staff account, remove the role first, since staff can't be suspended.
2. Check its entries in the audit log and the Workers Logs for its `account` hash; undo its changes in the admin panel (each undo is audited).
3. If it held a staff role, also check `/admin/users` for new accounts or roles it created, and rotate any secret it could have seen.
4. Before lifting the suspension, set a new password with the person (Set a password, which signs out everywhere) and confirm their linked sign-in methods.

### Defaced site or malicious deploy

Roll back (above), then find out how the change got there: the commit's author and the push in GitHub's security log, Workers Builds' build log, and the Cloudflare audit log. Rotate the credential that was used, and the Cloudflare and GitHub tokens if it's unclear which one.

## Deployment controls

These settings live outside the repository, so the code can't enforce them. Recheck them after any account change and at least twice a year, and record what you found in an issue.

**Cloudflare (dashboard, `firelandscurrent.com` zone)**

- [ ] SSL/TLS, Edge Certificates: **Minimum TLS Version 1.2.** Browsers dropped 1.0 and 1.1 years ago; raising the minimum affects only very old clients and bots.
- [ ] Always Use HTTPS on, and TLS 1.3 on.
- [ ] HSTS stays as the site sends it (`max-age=31536000`, no `includeSubDomains`, no preload); leave Cloudflare's own HSTS setting off so the two don't disagree (README, "HTTPS and HSTS").
- [ ] Caching: no Cache Rule that caches HTML or overrides origin `Cache-Control` (README, "Response caching").
- [ ] Security, WAF: the Cloudflare Free managed ruleset on; no custom rule that skips security for `/api/*` or `/admin/*`. Bot Fight Mode is optional; if it's on, check that Turnstile forms and the Facebook link previews still work.
- [ ] DNS: DNSSEC on (Namecheap needs the DS record Cloudflare gives you). Add a CAA record limiting certificates to the authorities Cloudflare uses, if you want one.
- [ ] Namecheap: registrar lock on, two-factor sign-in on, contact email current.
- [ ] Account: two-factor sign-in on every Cloudflare member (today, the owner only); API tokens scoped to what they're for, with an expiry where possible; delete tokens nobody uses.
- [ ] Workers Builds: connected to `main` only, using a build token limited to this Worker; build and deploy commands unchanged (`npm run build`, `npx wrangler deploy`).
- [ ] Worker secrets: the list matches what the code reads (`npx wrangler secret list`). Set `SECURITY_ALERT_EMAIL` so security alerts reach a mailbox instead of only the logs.
- [ ] R2: the `firelands-current-media` bucket has no public `r2.dev` URL or custom domain (images are served through the Worker) and no CORS policy; no R2 API tokens beyond the ones you use.
- [ ] Email Routing and Sending: `news@`, `contact@`, and `ads@` deliver to mailboxes the owner controls.

**GitHub (`jmusick/firelands-current`, public)**

- [ ] Two-factor sign-in on the owner's account; review Settings, Sessions and authorized OAuth and GitHub apps.
- [ ] Collaborators: owner only. No deploy keys.
- [ ] Secret scanning and push protection on. Dependabot security updates are off; the weekly grouped update in `.github/dependabot.yml` covers it.
- [ ] Actions: default workflow permissions read-only; consider "Require actions to be pinned to a full-length commit SHA" (Settings, Actions), since every workflow already pins.
- [ ] Branch rules on `main`: none, by choice (README, "Dependency review and provenance" and "Secret scanning"). Pushes to `main` deploy without review; the pre-push secret scan is the gate.

**Other services**: Google (Analytics, Search Console, sign-in), Meta (both apps and the Page), and Apple and Microsoft once configured. Two-factor sign-in on each, and an admin list limited to the owner.
