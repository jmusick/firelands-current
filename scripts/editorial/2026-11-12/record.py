"""Complete the budget review and preserve observed browser evidence."""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

p = editorial_directory('2026-11-12')
f = p / 'review.md'
s = f.read_text(encoding='utf-8')
s = s.replace('_fill in_: one paragraph on what you compared against (counts), how many stories, events and updates you are proposing, and that nothing has been imported or published.', 'Compared 142 published stories, 112 events and 58 library images. Three verified stories, one calendar candidate and no updates to existing coverage. Research has made no database writes. The publisher expressly authorized local-dev publication, production sync and Facebook queuing; a separate publication record will report the outcome. The webinar remains for calendar review; no event is proposed for today.')
for why in ['Wednesday appointment announcement; Schools is thin', 'Current Nov. 24 procurement deadline; Outdoors is thin; regional trail connection', 'Current Nov. 9 recruitment notice with pay and Dec. 9 deadline']:
    s = s.replace('| _fill in_ |', '| ' + why + ' |', 1)
s = s.replace('_fill in_: a short paragraph per story on what is verified, what is not, and the trap to avoid.', '''Rudolph: the [Nov. 11 district release](https://www.scs-k12.net/protected/ArticleView.aspx?iid=6IIYII0&dasi=3GGI) confirms the appointment, bus driving since 2017 and career background. No effective date, salary, predecessor or route change inferred. Background is attributed; promotional assessments cut.

Genoa: the [13-page RFQ](https://ottawacountyparksoh.org/wp-content/uploads/2026/11/LPA-ConsInspConsAdmin-Programmatic-Announcement-Genoa-Phase-One-Veterans-Park-to-9th-St-1.pdf) is dated Oct. 30 and remains open until Nov. 24 at 4:30 p.m. Pages 1-4 visually checked; full text saved. The $1,266,917.50 estimate concerns construction, not consultant fees. December authorization is anticipated; no construction award, start or opening reported. The village park page confirms existing Elmore/Lindsey/Fremont connections. Earlier STIP estimates surfaced in search were not substituted for this dated estimate.

Social services worker: all three scanned pages visually checked, with Nov. 9 posting, Dec. 9 at 4:30 p.m. closing, $20.54/$21.36 pay and qualifications verified against the live job index. County application page read without submitting data. No shortage or new-position claim. Other clerical/eligibility postings remain leads; their scanned qualifications were not visually verified today.''')
s = s.replace('_fill in_: cleared images with credit and license; permission requests drafted (not sent) with the contact; photos the editor could take. Delete this section if there are none.', 'No cleared subject photos found in the 58-image library. All three stories use image.status none and the masthead preview; no feature changes. A school-building file photo is available but does not show Rudolph or transportation. Public portraits and trail website photos are not cleared for reuse. No image requests sent.')
s = s.replace('| _fill in_ | _fill in_ |', '| Regional trail connections and village records | Browser works when direct HTTP returns 403. Use current park-district procurement for deadlines; seasonal quarry hours remain after closing. |', 1)
s = s.replace('| _fill in_ | _fill in_ |', '| Shelter support, volunteering and donation leads | Separate nonprofit from county operations. Undated site does not establish launch date; verify campaign deadlines and current dogs. |', 1)
notes = {
    'county-jobs': 'Three Nov. 9 postings; social services worker selected and PDF checked.',
    'odnr-news': 'HTTP 404; browser index still has Nov. 10 K9 release newest, already covered.',
    'sea-grant': 'No newer report than Oct. 27; found free Nov. 18 webinar.',
    'glcap': 'Veteran report already covered; no newer selected lead.',
    'sandusky': 'Leaf collection and volunteers already covered.',
    'huron': 'Firefighter appointment covered; other index notices older.',
    'milan': 'Holiday meetings and yard waste already covered.',
    'erie-parks': 'Nature center hours; no fresh verified announcement selected.',
    'county-parks': 'Existing Nov. 20 walk and Nov. 21/25 programs; no padded story.',
    'health': 'HTTP 403; browser index checked, grant body still absent.',
    'growth': 'Nov. 11 leadership announcement already covered.',
    'monroeville': 'Variance hearing no longer on homepage; no outcome inferred. Holiday notices remain.',
    'ottawa-parks': 'Current Genoa RFQ selected; hiking challenge and grants covered.',
    'danbury': 'Leadership nomination notice already covered.',
    'schools': 'New Nov. 11 Rudolph release selected.',
    'huron-schools': 'Visible notices older; conversation already in calendar.',
    'school-joseph': 'Dated primary release preserved; appointment verified.',
    'sea-webinar': 'Nov. 18 noon-12:30 p.m.; free with registration; calendar candidate.',
    'united-way': 'No verified new announcement selected.',
    'margaretta': 'Veterans recognition and resources; no fresh dated story selected.',
    'huron-county-dogs': 'Official county page links dog warden department; scouting lead.',
    'genoa-park': 'HTTP 403; browser confirms existing regional trail connection.',
    'genoa-ordinances': 'HTTP 403; year-specific records source, no new vote reported.',
    'county-apply': 'Current application accessible; read only, no submission.',
    'dog-friends': 'Support group and contacts saved; launch date unverified.',
}
rows = []
for name in ['sweep.json', 'detail-sweep.json', 'scouting.json']:
    for r in json.loads((p/'evidence'/name).read_text(encoding='utf-8')):
        at = datetime.fromisoformat(r['checked_at']).astimezone(timezone(timedelta(hours=-5))).strftime('%I:%M %p').lstrip('0').lower()
        result = notes.get(r['key'], 'HTTP ' + str(r.get('status', 'error')) + '; not reached for current content.' if r.get('status') != 200 else 'Read index; no additional verified story selected.')
        rows.append(f"| [{r['key']}]({r['url']}) | {at} Eastern | {result} |")
manual = [
    ('Job PDF', 'https://www.eriecounty.oh.gov/Downloads/2026-059%20-%20FT%20Social%20Services%20Worker%20I%20-%20JFS%20ADA.pdf', '10:26-10:27 a.m.', 'All three pages visually inspected; pay, qualifications and deadline.'),
    ('Genoa RFQ', 'https://ottawacountyparksoh.org/wp-content/uploads/2026/11/LPA-ConsInspConsAdmin-Programmatic-Announcement-Genoa-Phase-One-Veterans-Park-to-9th-St-1.pdf', '10:26-10:28 a.m.', 'Full PDF/text preserved; relevant four pages visually inspected.'),
    ('Sandusky Facebook', 'https://www.facebook.com/cityofsandusky', '10:25 a.m.', 'Expanded leaf reminder matches existing story.'),
    ('Health Facebook', 'https://www.facebook.com/ErieCoHealthOhio', '10:26 a.m.', 'Top family-health promotion; no verified service change selected.'),
    ('Schools Facebook', 'https://www.facebook.com/SanduskyCitySchools', '10:28 a.m.', 'Planetarium lead held for admission/access/occurrence checks.'),
    ('Perkins Facebook', 'https://www.facebook.com/PerkinsTownship', '10:31 a.m.', 'Leaf-pile reminder; existing coverage.'),
    ('Transit X', 'https://x.com/SanduskyTransit', '10:29 a.m.', 'Nov. 2 Yellow Line post latest visible; covered.'),
    ('Facebook event search', 'https://www.facebook.com/search/events/?q=Sandusky', '10:29 a.m.', 'Signed in; no results.'),
    ('Google News local search', 'https://news.google.com/search?q=Sandusky%20Ohio%20when%3A7d&hl=en-US&gl=US&ceid=US%3Aen', '10:28 a.m.', 'ODOT advisory remains a lead; dredging covered; veterans offers expired.'),
    ('Web discovery searches', 'https://www.google.com/', '10:24-10:27 a.m.', 'Local, ODNR, health, Genoa and dog-support leads. Selected copy uses saved primary sources.'),
]
rows += [f'| [{name}]({url}) | {at} Eastern | {result} |' for name, url, at, result in manual]
s = s.replace('| _fill in_ | | |', '\n'.join(rows))
s = s.replace('Every source you opened today, including the ones with nothing new.', 'Targeted sweep, not a claim that every listed account was reached. HTTP failures identified above. No social interactions or social images reused. Clerical/eligibility PDFs were downloaded as leads but not relied upon or visually verified.')
s += '''

## Follow-ups and validation

No urgent correction to existing coverage found. Monroeville hearing was a prior lead for today; its notice no longer appears on the homepage. Disappearance is not cancellation or evidence of an outcome. Held items retain earlier findings and require fresh verification. Resolved or expired leads remain in preceding packets.

All three drafts received newsroom Write and Check passes: NONE unresolved flags. No invented quotations, names, dates or outcomes. No cleared subject photos or featured recommendations. Validate packet, JD account-linked bylines, Newsroom discussions, local pages, migration parity, exact live story rows, section counts and social previews before Facebook delivery. Data-only publication needs no version bump, commit, push or deployment.
'''
assert '_fill in_' not in s
f.write_text(s, encoding='utf-8')
(p/'evidence/browser-excerpts.txt').write_text('''Browser evidence excerpts, observed Nov. 12, 2026 (Eastern). Read only; no source images reused.

https://genoaohio.org/village-departments/veterans-park-quarry/
The North Coast Inland Trail (NCIT) was extended into Veterans Park in 2020, and provided a separated active use trail connecting Genoa to Elmore, Lindsey, Fremont, and beyond.

https://eriehealthohio.com/echd-awarded-1-5-million-state-grant-to-expand-school-based-healthcare-services/
Rendered title, header image, helpful-articles link and clinical-review sentence; no release body, participating schools or implementation detail. Held.

https://www.facebook.com/cityofsandusky
Expanded official leaf notice: 2026 collection starts Thursday, Nov. 12 in Zone 2. Two passes; weather may shift dates. Dates match published story. No update selected.

https://x.com/SanduskyTransit
Newest visible post Nov. 2: Yellow Line off-season Mon-Sat 6:30 a.m.-8:30 p.m. as of Nov. 1. Already covered.

https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news
Browser index latest Nov. 10 K9 graduation, Nov. 9 Cowan Lake trail, Nov. 6 statewide acorn survey and Fairfield County wetland. No newer unreported selected local milestone.
''', encoding='utf-8')
