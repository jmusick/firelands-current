# Editorial packet tools

How a day's reviewed stories, events and story updates get from the project library into the site. Issue [#108](https://github.com/jmusick/firelands-current/issues/108) replaced the per-day `import.mjs` / `sync.mjs` copies with one tool, `scripts/editorial/packet.mjs`, driven by a JSON manifest. The editorial rules (what to write, which sources to trust) stay in [news-sources.md](news-sources.md); image and table rules are in [accessible-publishing.md](accessible-publishing.md). Backups, restores and rollbacks are in [operations.md](operations.md).

The dated scripts under `scripts/editorial/<date>/` stay in place. They are the record of what ran, and their journals refer to them. Do not copy one for a new day; write a manifest instead. The per-day notes that used to sit in the README are kept at the end of this page.

## What a packet is

A packet is one day's folder in the [project library](../../../Projects/firelands-current/README.md) (`editorial/<date>/`, or wherever `FIRELANDS_PROJECT_DIR` points). Besides the reporting evidence and drafts it holds:

| File | Written by | Purpose |
| --- | --- | --- |
| `packet.json` | the newsroom | The manifest: exactly what will be published. Frozen once the local import has run. |
| `research.json`, other `inputs` | the newsroom | Optional source files the manifest lists under `inputs`; their hashes are recorded so a later edit is noticed. |
| `images/…` | the newsroom | Original files for new uploads. |
| `local-before.json`, `local-import-pending.json`, `local-import.json` | `--apply-local` | Snapshot before, write intent, and the journal of what was written (rows, audit entries, photo checksums). |
| `production-before.json`, `production-content.json`, `sync-production.sql` | `--prepare` | The target's baseline, the reviewed rows, the SQL and its hash. |
| `production-write-intent.json`, `production-upload-intent.json`, `production-queue-intent.json`, `queue-facebook.sql` | `--publish`, `--queue` | Written before the first write of each kind. |
| `production-publication.json`, `production-facebook-queue.json`, `production-verification.json` | `--publish`, `--queue`, `--verify` | Results. |
| `evidence/…` | all modes | Verification reports and Wrangler output. |

These filenames follow the dated scripts. A new manifest cannot adopt an old import journal; use a separate rehearsal directory when comparing tools.

## The manifest (`packet.json`)

The [JSON Schema](../scripts/editorial/packet.schema.json) describes version 1 for editor validation. Runtime validation also checks cross-references, real dates, update-field allowlists and reviewed file hashes before any writes.

```json
{
  "schema": 1,
  "date": "2026-11-16",
  "summary": "Three briefs and one calendar event; one update to an existing story.",
  "inputs": ["research.json"],
  "publish_window": { "until": "2026-11-17T00:00:00-05:00" },
  "author": { "email": "jd@orboro.net", "name": "JD" },
  "stories": [
    { "key": "leaves", "slug": "sandusky-leaf-collection-…", "section": "local", "community": "Sandusky",
      "headline": "…", "summary": "…", "body": "Markdown…", "media": "photo-leaves" }
  ],
  "events": [
    { "key": "compost", "slug": "huron-library-composting-…", "title": "…", "summary": "…", "description": "…",
      "category": "classes", "starts_on": "2026-10-26", "start_time": "18:00", "ends_on": null, "end_time": "19:00",
      "hours_note": "", "venue": "…", "address": "…", "community": "Huron", "organizer": "…", "organizer_url": "…",
      "cost": "", "source_url": "https://…" }
  ],
  "updates": [
    { "table": "news_articles", "slug": "existing-story-slug",
      "fields": { "headline": "…", "summary": "…", "body": "…" },
      "baseline_sha256": "64 hex digits", "note": "why" }
  ],
  "features": [ { "slug": "existing-story-slug", "featured": true } ],
  "media": [
    { "key": "photo-leaves", "action": "reuse", "id": "<library media id>", "sha256": "<stored object sha256>",
      "caption": "…", "credit": "…", "source_url": "https://…", "license_url": "https://…" },
    { "key": "photo-new", "action": "upload", "file": "images/original.jpg", "content_type": "image/jpeg",
      "original_sha256": "…", "stored_sha256": "…", "alt": "…", "caption": "…", "credit": "…",
      "source": "Source: … | License: …", "audit_detail": "…", "source_url": "https://…", "license_url": "https://…" }
  ],
  "facebook": { "queue": "new-stories" },
  "expect": { "stories": 1, "events": 1, "updates": 1, "features": 0, "reused_media": 1, "uploads": 1 }
}
```

The example shows every key at once; a real packet usually uses a few. Individual lists may be empty. The tool validates the manifest before importing (`scripts/editorial/lib/manifest.mjs`).

- **`date`** must match `--date`. **`inputs`** are file names inside the packet folder; their hashes are stored in the local journal and every later mode refuses to run if one changed. Keys use lowercase kebab-case; packet file paths and existing symlink targets must stay within the packet folder. The manifest's own hash is guarded the same way.
- **`publish_window.until`** (optional, with an offset) is the end of the budget date. `--apply-local`, `--publish` and `--queue` refuse after it, so a stale budget is re-reviewed rather than published. `--ignore-window` skips it for rehearsals only (never with `--production`).
- **`author`** is the byline account. It must exist locally and, at `--prepare`, on the target, with the same id and name. The discussion author `newsroom` must exist too.
- **`stories`** become published stories with the author's byline, `featured` 0, a discussion thread, `story-create` and `story-publish` audit entries and a Facebook outbox row held in `review`. `media` names an entry in `media`. A body may not contain a `[NEED:` marker. Slugs must be unused.
- **`events`** become published events. `description` gets `\n\n[Organizer details](source_url)` appended and `link` is `source_url`, as in the dated scripts. Unlisted optional fields default to empty text (`ends_on`, `start_time` and `end_time` to null).
- **`updates`** change an existing, published story (`news_articles`) or event (`events`) in place: its slug, publication date, discussion and Facebook ledger are kept, and no new delivery is queued. `fields` may only touch `headline`, `summary`, `body`, `section`, `community` (stories) or the event text, date and venue fields. **`baseline_sha256`** is the SHA-256 of `JSON.stringify` of the row's current values for exactly the named fields, in the order given in `fields`, with `\r\n` turned into `\n`. Get it with `node scripts/editorial/packet-facts.mjs --baseline news_articles <slug> headline,summary,body`. The local import, and again `--prepare` against the target, refuse if the row no longer matches, so an update is only ever applied on top of the text that was reviewed. The write itself is guarded by the row's `updated_at`.
- Existing lead photos retained by story updates do not need `media` entries. `--verify-http` reads their original library rows from `local-before.json`, verifies the local files and rendered metadata, and records their checksums in its report. `--prepare` rechecks those facts and carries them into the production journal so publication and queuing verify the same photos. They are not counted as new uploads or explicit reuse, and neither the frozen manifest nor the import journal is rewritten.
- **`features`** (default none) set or clear one story's `featured` flag, with a `story-feature` or `story-unfeature` audit entry. Unfeaturing the previous selection must be listed explicitly. A story cannot be both updated and featured in one packet. Every verification compares the set of featured stories with what the packet planned, so an unplanned change in featuring fails.
- **`media`** entries are either `reuse` (a photo already in the media library, with the SHA-256 of its stored object, its caption and credit, all checked) or `upload` (a new file, run through the normal `checkUpload` / `storeMedia` pipeline that strips metadata, with a `media-upload` audit entry). `original_sha256` and `stored_sha256` are optional guards on the file and on the validated result. `source_url` and `license_url` must appear on the rendered story page. Every media entry must be used by a story.
- **`facebook.queue`** is `"new-stories"` (default) or a list of story keys. Stories not listed stay in review. `facebook.queue_detail` can replace the audit text.
- **`expect`** (optional but recommended) states the counts you intend, and the tool refuses if the lists disagree, which catches a story dropped from the manifest by accident.

## Modes

```
node scripts/editorial/packet.mjs --date YYYY-MM-DD <mode> [options]
```

| Mode | Touches | What it does |
| --- | --- | --- |
| `--apply-local` | local DB, local R2 | Once per packet. Refuses if `local-import.json` or `local-import-pending.json` exists. Checks the author, slugs, baselines and photo checksums; uploads any new photos through the media pipeline; writes stories (as drafts with their `review` Facebook rows already present, then published, so the publication trigger can never queue a delivery), events, discussions, updates, feature changes and audit entries in one batch; journals everything; then runs `--verify-local`. |
| `--verify-local` | local DB | Row counts against the pre-import snapshot, every new row field by field, every pre-existing row unchanged (except the planned updates), held Facebook rows, photo rows. Writes `evidence/local-import-verification.json`. |
| `--verify-http` | local DB, dev server | `--verify-local` plus every story and event page (headline, summary, discussion link, byline link, social preview, photo alt text, caption, credit and source/license links), every calendar export (including the start time), every photo's checksum, and the `/news` and `/events` lists, against `--origin` (default `http://127.0.0.1:4321`, localhost only). Writes `evidence/local-http-verification.json`. |
| `--prepare` | reads local DB; **read-only** on the target | Needs `evidence/local-http-verification.json`. Compares the target's baseline with the local database: same migrations, no conflicting slugs, discussions, deliveries or audit entries, the same author accounts, identical reused-photo rows, update targets matching their baselines. Checks reused photos are live. Writes `production-before.json`, `production-content.json` and `sync-production.sql` with its hash. |
| `--publish` | **writes** the target | Checks the SQL hash and the baseline again. Uploads new photos to R2 (upload intent first), writes the write intent, runs the SQL, re-reads and verifies every row, requires the outbox to still be in `review`, and verifies the live pages and photo checksums. Re-running after a write was started only re-verifies; it will not write twice. |
| `--queue` | **writes** the target | Requires `production-publication.json`, verifies the rows and the live pages again, then moves the chosen outbox rows from `review` to `pending`, with a `facebook_queue` audit entry each. Rows already pending, posting or posted are skipped; a row that has attempts is refused. |
| `--verify` | reads the target | Row-for-row check, counts against the baseline, section counts against the local database, queue audit entries, delivery statuses, live pages. Writes `production-verification.json`. |

Options: `--persist-to DIR` (local Wrangler state, default `.wrangler/state`), `--journal-dir DIR` (write journals and evidence there instead of the packet folder), `--origin URL`, `--production`, `--rehearsal-db DIR`, `--rehearsal-origin URL`, `--ignore-window`.

### Safety rules

- **Production modes** (`--prepare`, `--publish`, `--queue`, `--verify`) need exactly one of `--production` or `--rehearsal-db`. With `--production` the tool talks to the live D1 database and R2 bucket through Wrangler `--remote`, may not be combined with `--journal-dir`, `--persist-to`, `--ignore-window` or any rehearsal option (it uses the real library journals and the working local database), and prints a warning. **Run `--production` only on the owner's go-ahead** (AGENTS.md "Deployment"). Pushing to `main` is a separate step that also needs it.
- A mode that writes saves its intent file first, and the intent or result file of an earlier run makes the next attempt stop and ask for inspection. Journal claims are exclusive, so overlapping invocations cannot claim the same write. A repeated publish with a write intent performs verification only; it does not repeat SQL or uploads.
- Facebook deliveries are created in `review` and only released by `--queue`, after the rows and the live pages verified. Local Facebook delivery must be disabled (`FACEBOOK_AUTO_POST_ENABLED=false` in `.dev.vars`); the tool asserts it.
- The local verification compares the whole database with the snapshot taken before the import, so run `--verify-local`, `--verify-http` and `--prepare` before anything else changes the local database (the dated scripts had the same property). To publish two packets on one day, take the first through `--prepare` before importing the second.

## Writing a new day's packet

1. Report and review as usual (news-sources.md). Keep drafts and evidence in the packet folder.
2. Write `packet.json`. Use `packet-facts.mjs` for update baselines and for the stored checksum, caption and credit of a reused library photo (`node scripts/editorial/packet-facts.mjs --media <id>`). For a new photo, put the original under `images/` and give its license URL, source URL and SHA-256 of the reviewed original file. Upload failures discard only unreferenced files created by that attempt.
3. `node scripts/editorial/packet.mjs --date D --apply-local`, then start the dev server and run `--verify-http`. Review the pages. To change copy after the import, restore the local database and start again; editing the manifest afterwards makes the hash guards stop every later mode.
4. With the owner's go-ahead: `--prepare --production`, `--publish --production`, `--queue --production`, `--verify --production`, in that order. Apply any new migrations to production first (AGENTS.md "Database migrations").
5. Write `production-publication.md` in the folder as before, and push to `main` only if the owner asks.

Anything a packet cannot express (a static file such as the Fieldstone PDF, a new page, a schema change) still needs its own reviewed script or change.

## Rehearsing on a throwaway copy

The working local database must keep matching production, so rehearse the tool, or a risky packet, against copies:

```
# 1. Copy the local database and media bucket into new directories (export and restore, as in the restore drill).
node scripts/editorial/throwaway-copy.mjs --from <repo>/.wrangler/state --to <scratch>/copy
node scripts/editorial/throwaway-copy.mjs --from <repo>/.wrangler/state --to <scratch>/target   # a stand-in for production

# 2. Run the local modes against the first copy, with journals somewhere disposable.
node scripts/editorial/packet.mjs --date D --apply-local --persist-to <scratch>/copy --journal-dir <scratch>/journal
node scripts/editorial/packet.mjs --date D --verify-http --origin http://127.0.0.1:4414 --persist-to <scratch>/copy --journal-dir <scratch>/journal

# 3. Run the production modes against the second copy instead of production.
node scripts/editorial/packet.mjs --date D --prepare --persist-to <scratch>/copy --journal-dir <scratch>/journal \
  --rehearsal-db <scratch>/target --rehearsal-origin http://127.0.0.1:4414
```

`throwaway-copy.mjs` copies the source state first and exports from the copy, so the source is never opened for writing. A rehearsal target is a local D1 database and R2 bucket driven through `wrangler … --local --persist-to`, which runs the same SQL, file writes and checks as `--remote`. The tool refuses a rehearsal directory that is the working database. `astro dev` reads the `.wrangler/state` of its own checkout, so to serve a copy for the page checks, run the dev server from a checkout whose `.wrangler/state` is (a junction to) that copy, on a spare port.

A copy of the current local database already contains every packet that was published. To replay a past day, delete that packet's rows from the copy only (its stories, events, discussions, Facebook rows and audit entries, the media row if it uploaded a photo, and put an updated story's text back to its baseline) before `--apply-local`. Compare the resulting rows with the dated importer, normalizing generated IDs and timestamps.

Copies and journals hold personal data from the local database. Delete them when finished.

## Rebuilding a past packet

`node scripts/editorial/manifest-from-research.mjs --date 2026-10-24` reads the day's `research.json`, the dated run's `local-import.json` (which stories, events and updates actually ran, and the reviewed photo checksums) and `evidence/existing-content.json` (update baselines) and writes `packet.json`. It understands only the Oct. 21-26 layouts with reused photos; for anything else, write the manifest by hand. Set `FIRELANDS_PROJECT_DIR` to a scratch library folder holding copies of those files so the real library is not touched.

## Differences from the dated scripts

- **One code path.** The dated scripts differed by dates, counts, hard-coded image URLs and slugs; here those come from the manifest and the journal.
- **Local writes** always use the draft-then-publish order the November scripts introduced, so no Facebook row is ever `pending` locally. (The October scripts let the trigger create a `pending` row and flipped it to `review`; the final rows are the same apart from the trigger's second-rounded timestamps.)
- **Queue audit text** is one string (`facebook.queue_detail`) rather than per-day wording, and the audit row states `outcome` (`success`, the column default) explicitly.
- **Dates.** The dated scripts hard-coded a budget-date window per script (November) or none (October). The window is now optional manifest data.
- **Copy edits** (`prepare.mjs`) and **evidence capture** (`research.py`) are not part of the tool. Edit the copy, then write or regenerate the manifest, before the first import.
- Not covered: `scripts/editorial/2026-11-11/fieldstone-*.mjs` (the PDF), and the `publish.mjs` copies that live in the project library for Nov. 8 and 9.

## Dated utilities (historical notes)

These notes describe the per-day scripts as they stood when the shared tool replaced them. Their operations and assumptions are unchanged, and production commands among them still require deliberate authorization.

The Fieldstone local article includes an original release PDF served from `public/downloads/fieldstone-press-release-2026-11-10.pdf`, with a descriptive link naming the format, page count and file size. `node scripts/editorial/2026-11-11/fieldstone-local.mjs` imports the story and supplied photos locally; `node scripts/editorial/2026-11-11/fieldstone-pdf.mjs` adds its PDF link locally. Source files and import records stay in the project library under `editorial/2026-11-11/fieldstone/`. `node scripts/editorial/2026-11-11/fieldstone-sync.mjs` is the production sync: it refuses to run until the PDF is live at that address, writes the story, photos and discussion with write-intent journals, verifies the live page and checksums, then releases the held Facebook delivery. The PDF is a static file, so it goes live only with a deploy of `main`.


The associated October 2–24 editorial utilities live in `scripts/editorial/<date>/`; October 9 image utilities live in `scripts/image-publication/2026-10-09/`; campaign utilities live in `scripts/ad-creatives/<campaign>/`. The shared JavaScript `scripts/project-library.mjs` and Python `scripts/project_library.py` helpers resolve the library relative to the source checkout, defaulting to `../../Projects/firelands-current/` from the repository root. Set `FIRELANDS_PROJECT_DIR` to an absolute library path for a different checkout layout. Run utilities from the repository root so Wrangler configuration, dependencies, and the local database resolve correctly. Python artwork rendering also requires Pillow; JavaScript image export uses the installed Sharp dependency. The dated utilities retain their original operations and assumptions; production commands still require deliberate authorization.

The November 12 utility, `node scripts/editorial/2026-11-12/publish.mjs`, supports `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed stories about Sandusky schools transportation leadership, Genoa trail construction oversight and Erie County social services recruitment. It leaves the webinar calendar candidate in the review packet, adds no media and holds Facebook deliveries until live-page checks pass. Publication and queuing require the November 12 review date. Inspect the project-library write-intent journals before retrying writes.

The November 11 utility, `node scripts/editorial/2026-11-11/publish.mjs`, supports `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed briefs about Erie County wildlife officer Michele Butler and K9 River, 2027 Leadership Huron County applications and Milan holiday council meetings. It adds no events or media and holds Facebook deliveries until live-page verification. Publication and queuing require the November 11 review date. Review packets and write-intent journals remain in the project library; inspect them before retrying writes.

The November 10 utility, `node scripts/editorial/2026-11-10/publish.mjs`, supports `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed briefs about Danbury leadership nominations, veteran housing support and Huron library recruitment. It adds no events or media, preserves existing content and featured selections, and holds Facebook deliveries for live-page verification. Publication and queuing require the November 10 review date. Review packets and write-intent journals remain in the project library; inspect them before retrying writes.

The November 7 utility, `node scripts/editorial/2026-11-07/publish.mjs`, supports `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed briefs about Woodlawn Avenue water-line work, GLCAP board voting and Goodwill coat assistance, plus a dated follow-up link in the earlier nomination story. It imports no calendar candidates or media, preserves featured selections and existing Facebook deliveries, and holds new deliveries until live-page checks pass. Publication and queuing require the November 7 review date. Research and write-intent journals remain in the project library; inspect them before retrying writes.

The November 6 utility, `node scripts/editorial/2026-11-06/publish.mjs`, uses those same modes for Opportunity Zone designations, Cedar Point's 2027 calendar and spring turkey dates, plus the completion update to the existing harbor-dredging story. It adds no events or media, preserves featured selections and the updated story's Facebook ledger, and refuses publication or queuing after its review date.

The November 5 utility, `node scripts/editorial/2026-11-05/publish.mjs`, uses `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed briefs about the Erie County deputy-clerk deadline, Sandusky's Walleye research vessel and Ohio's military park discount, plus the district response in the existing levy story. It verifies the update against its reviewed baseline, preserves its original discussion and Facebook ledger, and holds the three new deliveries until live-page checks pass. It adds no events or media and preserves featured selections. Publication and queuing refuse to run after the clerk deadline, Nov. 6 at 4:30 p.m. Eastern. Research and write-intent journals are retained in the project library; inspect them before retrying a write.

The November 4 utility, `node scripts/editorial/2026-11-04/publish.mjs`, uses `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed briefs about the unofficial Sandusky school levy result, Erie County commissioner/auditor returns and GLCAP water-audit certifications. It adds no events or media, preserves featured selections and holds Facebook delivery until live pages pass verification. Research and write-intent journals are retained in the project library; inspect them before retrying a write.

The November 3 utility, `node scripts/editorial/2026-11-03/publish.mjs`, uses `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` for three reviewed briefs about Yellow Line hours, Port Clinton utility recruitment and Norwalk leaf pickup, plus the existing Winter Crisis assistance guide update. It reuses one licensed library photo, checks local/production metadata and image checksums, preserves featured selections and the updated guide's Facebook ledger, and leaves two meeting candidates unimported. Inspect project-library write-intent journals before retrying any write.

The October 31 and November 2 `publish.mjs` utilities use that workflow for three stories each. October 31 also updates the existing Camp Street story; November 2 leaves its two calendar candidates unimported. Both preserve existing Facebook deliveries and featured selections, add no media and retain their research and publication journals in the project library.

The October 30 utility, `node scripts/editorial/2026-10-30/publish.mjs`, follows that guarded `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` workflow for three reviewed briefs about the Sandusky choir grant, Perkins leaf collection and local WarmChoice weatherization access. It adds no calendar entries or media and preserves featured selections. Inspect retained project-library write-intent journals before retrying an operation.

The October 29 utility, `node scripts/editorial/2026-10-29/publish.mjs`, follows the same `--local`, `--local-http`, `--prepare`, `--publish`, `--queue` and `--verify` workflow for two reviewed briefs about boat-wrap recycling and Monroeville email. It adds no calendar entries or media and preserves existing featured selections. Review the retained project-library journals before retrying any write.

The October 28 utility, `node scripts/editorial/2026-10-28/publish.mjs`, imports three reviewed stories with `--local` and checks their local pages with `--local-http`. After publisher authorization, use `--prepare`, `--publish`, `--queue` and `--verify` in order. It checks author accounts, migrations, duplicate conflicts, discussion links and social previews before releasing Facebook deliveries. Existing content and featured selections stay unchanged; there are no calendar additions or image uploads. Research, copy preparation and publication journals are retained in the project library; inspect journals before retrying a write.

The October 10 utility, `node scripts/editorial/2026-10-10/import.mjs --apply-local`, imports its project-library package once, using the normal media validator and upload audit. It preserves existing content and holds new Facebook outbox records in review. It has no production mode. Use `--verify-local` to check saved rows and R2 checksums, or `--verify-http` with the dev server running to check story/event pages, discussion links and image responses. The dredging photo uses an uncropped body figure to respect its CC BY-ND license; the other two file photos are lead images.

The October 17 utilities use the same local review and media-validation workflow for four stories, six events and two updates to existing coverage. Run `node scripts/editorial/2026-10-17/import.mjs --apply-local` once, then `--verify-local` or `--verify-http`. After publisher authorization, `node scripts/editorial/2026-10-17/sync.mjs --prepare` checks the production baseline and migrations; `--publish` verifies live content and the licensed school photo before `--queue` releases the four new Facebook deliveries. `--verify` records live-page checks, section counts and delivery status. Existing shared stories are updated without being reposted; featured selections are unchanged. Journals in the project library prevent blind retries.

The October 19 utilities follow that workflow for three stories, seven events and two story updates, with a validated public-domain village photo. Run `node scripts/editorial/2026-10-19/import.mjs --apply-local`, followed by `--verify-local` or `--verify-http`; the matching `sync.mjs` uses `--prepare`, `--publish`, `--queue` and `--verify`. Existing stories are checked against the reviewed baseline before their updates are applied.

The October 21 package contains four stories and six events. Before its first import, `node scripts/editorial/2026-10-21/prepare.mjs` saves the original budget and makes the final copy edits; it refuses to edit a packet with an import journal. Its `import.mjs` supports `--apply-local`, `--verify-local` and `--verify-http`, reuses an existing library photo without uploading media and checks that pre-existing content is unchanged. The matching `sync.mjs` supports `--prepare`, `--publish`, `--queue` and `--verify`: preparation checks schema, author accounts, reviewed copy and the existing production image; publication verifies the 10 live pages and six calendar exports before Facebook is queued. This utility syncs only that reviewed packet, verifies its additions and section counts, and preserves feature selections. Prepared-package hashes and retained journals guard against changed copy and duplicate retries; they must be inspected before repeating an operation.

The October 22 package adds three stories, five ready events and an update to the existing Halloween voting story; one unconfirmed concert stays excluded. Its `prepare.mjs` finalizes the copy before `import.mjs --apply-local`, and the matching `sync.mjs` checks the existing story against its reviewed baseline before updating it without queuing a duplicate Facebook post. The October 23 `import.mjs` adds only its three stories and one newly validated public-domain photo; its four calendar candidates stay in the review packet. Its matching `sync.mjs` uploads the validated photo, verifies live stories and the image checksum, then permits Facebook queuing. Both packages use the same verification modes, retain publication journals in the project library and preserve featured selections.

The October 24 `research.py` preserves primary-page HTML, extracted text and source checksums in the project library (requires Python Requests). Its `import.mjs` adds three reviewed stories and four events, including three calendar candidates rechecked from the previous day's packet, and reuses an existing licensed city photo. Run `--apply-local` once, then `--verify-local` or `--verify-http`; `sync.mjs` supports `--prepare`, `--publish`, `--queue` and `--verify`. Production author accounts, migrations, duplicate conflicts and the existing image checksum are checked before publication. Seven public pages and four calendar exports are verified before the three new Facebook deliveries can be queued. Existing content and featured selections remain unchanged.

The October 25 `import.mjs` imports only the three approved stories; the packet's events and proposed updates remain for a separate editorial decision. It reuses two existing library photos and retains their metadata. Use `--apply-local` once, then `--verify-local` or `--verify-http`. Its `sync.mjs` supports `--prepare`, `--publish`, `--queue` and `--verify`, checking author accounts, migrations, conflicts, live stories and both image checksums before releasing the three Facebook deliveries. No media upload or feature change is included. Preparation and delivery journals are retained in the project library; inspect them before retrying a write.

The October 26 utilities follow that story-only workflow for the Clyde charter preview, Norwalk large-item pickup and Clyde buyer program. Run `prepare.mjs` before the first import, then `import.mjs --apply-local` and its verification modes. One licensed Clyde file photo is validated through the media library; the Norwalk image is reused. The matching `sync.mjs` checks production conflicts, migrations and existing media before uploading the validated new image and publishing, then verifies all three live stories and both image checksums before `--queue` releases Facebook delivery. Calendar candidates, proposed updates and featured selections are unchanged; retained journals guard against duplicate writes.

The October 27 `publish.mjs` imports three ready stories, five events and three existing-content updates with `--local`; its unverified Christmas assistance draft stays excluded. Use `--local-http` with dev running, then, after publisher authorization, `--prepare`, `--publish`, `--queue` and `--verify`. It checks reviewed baselines, accounts, migrations, discussions, public pages and calendar exports, holds new Facebook deliveries until live verification, and preserves existing deliveries and feature selections. No images are uploaded. The pantry story expires at noon Oct. 27, so publication and queuing refuse to run after that time. Inspect retained journals before retrying a write.

After publisher authorization, `node scripts/editorial/2026-10-10/sync.mjs --prepare` checks production conflicts and author accounts, exports validated local image bytes, and features the two new stories with lead photos locally. Run `--publish` to upload and verify production R2 objects and insert the approved stories, events, media audits and discussions, holding Facebook entries in review until live-page checks pass. Run `--queue` to release the three new stories with audited queue actions, then `--verify` to compare content and counts, verify live pages and image checksums, and record Facebook delivery status. These operations retain publication evidence in the project library and do not deploy Worker code.

For the October artist campaigns, `node scripts/ad-creatives/2026-10-artists/prepare.mjs` rebuilds exports; `node scripts/ad-creatives/2026-10-artists/publish.mjs` validates and prepares publication SQL. Publishing requires the explicit `--publish --local` or `--publish --remote` arguments and authorization for the selected target. Give replacement artwork new media IDs and object keys because existing images have long-lived caching.
