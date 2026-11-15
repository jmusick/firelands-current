# Outreach tracker

The tracker for issue #34 is private working data at `outreach/tracker.json` in the project library. Resolve the library with `scripts/project-library.mjs`; set `FIRELANDS_PROJECT_DIR` to use another absolute directory. Contact details, authorization, correspondence and analytics evidence stay there, outside Git.

Run from the repository root:

```sh
node scripts/outreach.mjs init
node scripts/outreach.mjs check
node scripts/outreach.mjs summary
```

`init` creates an empty tracker and refuses to overwrite an existing file. Edit the JSON, then run `check`. The tool never contacts anyone, fetches a page, reads analytics, or changes the database. Authorization records document the owner's approval for the specific message; they do not authorize a future send or follow-up. Keep coverage decisions independent of links or responses.

The version 1 format has `contacts` and `referrals` arrays. Each contact represents one outreach conversation; use a stable unique `id`. This fictional example illustrates the fields; do not import it as actual outreach:

```json
{
  "version": 1,
  "contacts": [{
    "id": "example-library",
    "organization": "Example library",
    "relevantPage": "https://library.example/resources",
    "contact": "Resource page editor; see private draft",
    "relevance": "Resource page serves residents looking for local information",
    "destinationUrl": "https://firelandscurrent.com/",
    "authorization": {"status": "pending"},
    "sentOn": null,
    "response": "Not sent",
    "followUp": {"on": null, "action": "Owner review before sending"},
    "evidence": "2026-11-15/example-library/draft.md",
    "backlinks": []
  }],
  "referrals": []
}
```

`authorization.status` is `pending`, `approved` or `declined`. Approval also requires `on` (ISO date) and `evidence` (a reference to the approval). `sentOn` is an ISO date or `null`; a sent message requires prior approval. Preserve the dated sent copy and replies in `outreach/YYYY-MM-DD/<organization>/` and reference those records in `evidence`. State when responses are unknown; do not infer agreement from a draft. `followUp` records a next action and optional ISO date, without scheduling or sending it.

Add a backlink only after checking the actual external page and its destination. Each `backlinks` entry has `url`, `destinationUrl`, `checkedOn` (ISO date), `live` (boolean), `relevant` (boolean), and `evidence`. Retain observations, including a later missing link (`live: false`). The summary uses the latest observation per page URL; on the same date the last observation wins. It counts distinct relevant linking hostnames with at least one live observation, normalizing `www.` and case. Other subdomains remain distinct; review hosted sites and domain aliases manually. Multiple contacts or links on one website do not inflate this metric. Counts describe recorded observations, not a current crawl; recheck stale observations before reporting results. Requested placements never count as acquired links.

Record referral visits as **sessions**, with one row per referring website and reporting period:

```json
{"website":"https://library.example/","from":"2026-11-01","through":"2026-11-30","sessions":4,"evidence":"2026-12-01/referral-report.md"}
```

Use inclusive ISO dates, the same reporting timezone (America/New_York) and session definition, and consistent nonoverlapping periods across websites. Store the analytics report or its provenance in the library. The validator rejects overlapping periods for the same normalized hostname to prevent double counting. The summary groups sessions by exact period and never adds different reporting windows together. An empty referral summary means **not measured**, not zero visits. A zero row means the report measured zero sessions. Referral sessions may exist without a verified backlink; do not claim outreach caused a visit or a ranking improvement. Evaluate unique relevant websites and referral sessions rather than raw link totals.
