import sys, json, subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory
p=editorial_directory('2026-11-02')
data=json.loads((p/'production-content.json').read_text(encoding='utf-8'))
verified=json.loads((p/'production-verification.json').read_text(encoding='utf-8'))
before=json.loads((p/'production-before.json').read_text(encoding='utf-8'))
local=json.loads((p/'evidence'/'local-http-verification.json').read_text(encoding='utf-8'))
time=subprocess.check_output(['node','-e',"process.stdout.write(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(process.argv[1])))",verified['checked_at']],text=True)
rows=[]
for story in data['articles']:
 ledger=next(row for row in verified['facebook'] if row['article_id']==story['id'])
 assert ledger['status'] in ('pending','posting','posted') and ledger['last_error'] is None
 rows.append(f"| [{story['headline']}](https://firelandscurrent.com/news/{story['slug']}) | {ledger['status']} | {ledger['attempts']} |")
report=f'''# Nov. 2, 2026 publication record

Publisher explicitly requested a daily budget, newsroom drafts in local dev, production sync and Facebook queue. Three stories completed that sequence. Verified at {time} Eastern Nov. 2. Queued means pending delivery, not a claim that Facebook has already posted them.

| Published story | Facebook status | Attempts |
| --- | --- | --- |
'''+ '\n'.join(rows)+f'''

## Verification

- Packet validator: three ready stories, two calendar candidates, no errors or warnings.
- Newsroom Write and Check passes: source fact inventory, three headlines and no unresolved flags for each story.
- Local import: three stories, three discussions, six creation/publication audit entries. JD's account-linked byline on every story. Facebook auto-posting disabled locally; new local entries held in review.
- Local browser review and automated HTTP checks: all three pages, summaries, linked bylines, discussions and masthead preview metadata verified.
- Production preflight: no slug or ID duplicates, JD and Newsroom accounts verified, migration lists matched. No migrations or code deployment needed.
- Production rows exactly match reviewed local story content. All three public URLs returned 200. Existing featured stories and unrelated content preserved.
- Production story count: {before['counts'][0]['stories']} to {verified['counts']['stories']}; discussions: {before['counts'][0]['discussions']} to {verified['counts']['discussions']}; images: {verified['counts']['images']} unchanged.
- Per-section published-story counts match local: {json.dumps(data['local_sections'])}.
- Three first-time Facebook entries verified pending, zero attempts, no post IDs and no errors. Three queue audit entries verified. Publisher health's last error is null; actual delivery is handled by the regular worker.
- npm run check: zero errors, zero warnings, two existing hints. npm run build: completed successfully (sandbox denied its optional Wrangler log write).

## Scope and retained evidence

Two calendar candidates (Dark Skies at Marinas and Perkins Thanksgiving food drive) remain in research.json and review.md. Neither was imported or queued. Existing production events remain {verified['counts']['events']}; local events remain {local['counts']['events']}. The four-event count difference existed before this story-only sync and was not changed.

No images uploaded or reused without permission. No featured-story changes, commits, pushes, version bumps, emails or direct social actions. Village of Milan source added to docs/news-sources.md without committing; pre-existing source-directory edits preserved.

Before snapshots, source HTML/text, browser transcriptions, SQL, content hashes, write-intent journals and local/production checks remain in this dated project-library folder. Inspect journals before retrying a mutation.
'''
(p/'production-publication.md').write_text(report,encoding='utf-8')
review=(p/'review.md').read_text(encoding='utf-8')
(p/'review.md').write_text(f'# Publication completed\n\nThree stories are live locally and in production. Three Facebook entries verified pending with zero attempts and no errors at {time} Eastern. Two calendar candidates remain unimported. [Publication record and live links](production-publication.md).\n\n'+review,encoding='utf-8')
print('Saved publication record and updated review packet')
