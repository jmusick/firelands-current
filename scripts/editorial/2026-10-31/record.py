import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory
p=editorial_directory('2026-10-31')
data=json.loads((p/'production-content.json').read_text(encoding='utf-8'))
verified=json.loads((p/'production-verification.json').read_text(encoding='utf-8'))
lines=['# Oct. 31, 2026 publication record','',
'Completed the publisher-authorized local import, rendered local review, production sync and first-time Facebook queue. Final verification: 9:16 a.m. Eastern.','',
'## New stories','']
for row in data['articles']:
 lines.append(f"- [{row['headline']}](https://firelandscurrent.com/news/{row['slug']})")
lines += ['','## Existing coverage updated','']
for change in data['updates']:
 row=change['after'];lines.append(f"- [{row['headline']}](https://firelandscurrent.com/news/{row['slug']})")
lines += ['','Camp Street retains its URL, original publication time, discussion and Facebook delivery history. The dated update confirms resurfacing while retaining the warning that striping is pending.','',
'## Verification','',
'- Three new stories and three discussions added; one existing story updated. All four local and production pages returned HTTP 200 with correct headlines, summaries, JD account-linked bylines and discussion links.',
'- Local and production published-story section counts match. Production now has 111 stories, 108 events, 224 discussions and 56 media items. No event or image added. Local event count was already 112 versus 108 production; unrelated events were not synced.',
'- Three new Facebook entries verified pending, with zero attempts, no post IDs and no errors. Queued does not mean posted. Publisher health had no last error.',
'- Previously delivered Camp Street Facebook row and existing discussion unchanged. Featured selections unchanged. No cleared subject photographs available; masthead social previews verified.',
'- Packet checker: no problems. Astro check: zero errors/warnings, two existing unused-variable hints. Production build passed. Git diff whitespace check passed.',
'- Source HTML/text and rendered browser excerpts retained under evidence/. Exact local/remote SQL, before snapshots and write/queue intent journals retained in this folder.',
'- No commit, push, version bump or code deployment. Source guidance and dated editorial utilities remain uncommitted. Local dev is running at http://127.0.0.1:4321/news.','']
(p/'production-publication.md').write_text('\n'.join(lines),encoding='utf-8')
review=p/'review.md'
review.write_text('# Publication completed\n\nThree new stories and the Camp Street update are live locally and in production. Three first-time Facebook entries verified pending with zero attempts and no errors at 9:16 a.m. Eastern. [Publication record and live links](production-publication.md).\n\n'+review.read_text(encoding='utf-8'),encoding='utf-8')
print('Saved publication record and linked it from review packet')
