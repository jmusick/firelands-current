"""Record verified publication and queue results without changing content."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

p = editorial_directory('2026-11-03')
read = lambda name: json.loads((p / name).read_text(encoding='utf-8'))
data, verified, before = (read(name) for name in ['production-content.json', 'production-verification.json', 'production-before.json'])
assert len(data['articles']) == 3 and len(data['updates']) == 1
assert verified['sections_match_local'] and verified['features_unchanged']
assert len(verified['facebook']) == 3
assert all(row['status'] in ['pending','posting','posted'] and row['last_error'] is None for row in verified['facebook'])
time = subprocess.check_output(['node', '-e', "process.stdout.write(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(process.argv[1])))", verified['checked_at']], text=True)
rows=[]
for a in data['articles']:
    f=next(f for f in verified['facebook'] if f['article_id']==a['id'])
    rows.append(f"| [{a['headline']}](https://firelandscurrent.com/news/{a['slug']}) | {f['status']} | {f['attempts']} |")
change=data['updates'][0]['after']
report=f'''# Nov. 3, 2026 publication record

Completed the publisher's explicit request for daily-budget research, newsroom drafts in local dev, production sync and Facebook queue. Verified at {time} Eastern Nov. 3. Queue status is not a claim of completed Facebook delivery.

| Published story | Facebook status | Attempts |
| --- | --- | --- |
'''+ '\n'.join(rows)+f'''

Updated existing coverage: [{change['headline']}](https://firelandscurrent.com/news/{change['slug']}). Preserved its original publication date, account-linked byline, discussion and existing Facebook ledger; no duplicate share queued.

## Verification

- Packet validator: three ready stories, two review-only meeting candidates and one guide update; no errors or warnings.
- Newsroom Write and Check: three headlines, fact inventories, original copy and no unresolved flags. Port Clinton certification conflict and missing pay period explicitly disclosed; no inference of hourly pay or newly created employment.
- Local import verified three stories, three discussions, seven audited creation/publication/edit actions, one existing library image reused and no unrelated-row changes. Local Facebook delivery disabled and new records held in review.
- Local browser review completed for all three briefs, the updated guide and the reused Norwalk photo. Credited public-domain streetscape and descriptive alt text verified. Five local HTTP checks include four stories and the image checksum.
- Production preflight checked accounts, no duplicate slugs/IDs, matching migrations, exact existing guide baseline and existing image metadata/bytes. A transient Cloudflare 7403 preflight error cleared; subsequent read-only database check and full preflight succeeded before any production write.
- Production rows exactly match reviewed content; all four public story URLs and the reused image returned 200. Source/credit/license links, social previews, linked bylines and discussions checked.
- Production stories: {before['counts'][0]['stories']} to {verified['counts']['stories']}; discussions: {before['counts'][0]['discussions']} to {verified['counts']['discussions']}; images: {verified['counts']['images']} unchanged. Published story counts by section match local.
- Three queue audit entries verified. At {time} Eastern, all three new Facebook entries were pending, zero attempts, no post IDs and no errors. Publisher health last error was null. Normal scheduled Worker handles delivery.
- npm run check: zero errors, zero warnings, two existing hints. npm run build: successful; optional Wrangler log write encountered sandbox permissions. Local dev server restarted and remains available at http://127.0.0.1:4321/news.

## Scope

Two Milan holiday meeting candidates remain unimported. Production events remain 108 and local events 112; the four-entry difference existed before this story-only sync. No new media uploaded, no featured selections changed, no commits, pushes, version bumps or Worker deployment. Port Clinton employment-source guidance and the Norwalk overview/detail trap added to docs/news-sources.md, preserving pre-existing edits. README documents the new utility.

Research evidence, exact SQL, hashes, before snapshots, publication and queue intent journals, local verification and production verification remain in this project-library folder. Inspect them before retrying a mutation. No messages, permission requests or direct social interactions were sent beyond the authorized posting queue.
'''
(p/'production-publication.md').write_text(report,encoding='utf-8')
review=(p/'review.md').read_text(encoding='utf-8')
if not review.startswith('# Publication completed'):
    (p/'review.md').write_text(f'# Publication completed\n\nThree new stories are live locally and in production; the existing heating-assistance guide is updated. Three Facebook shares verified queued at {time} Eastern with no errors. Two meeting candidates remain unimported. [Publication record and live links](production-publication.md).\n\n'+review,encoding='utf-8')
print('Publication record saved; review packet updated.')
