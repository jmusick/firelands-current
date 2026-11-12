"""Prepare the verified November 11 budget without writing to either database."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

directory = editorial_directory('2026-11-11')
assert not (directory / 'local-import.json').exists()

k9_url = 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/k9-graduation-2026'
lead_url = 'https://huroncountyohio.com/2027lhc/'
application = 'https://huroncountyohio.com/wp-content/uploads/2026/10/LHC-App-Info-2027.pdf'
milan_url = 'https://milanohio.gov/'

stories = [
    dict(key='k9', slug='erie-county-wildlife-officer-michele-butler-k9-river-graduation-november-2026',
         section='outdoors', community='Erie County',
         headline='Erie County wildlife officer and K9 River graduate from ODNR program',
         summary='Michele Butler and River are among three new ODNR K9 teams recognized Tuesday. The teams support tracking, evidence searches and public education.',
         body=f'''Erie County wildlife officer Michele Butler and her new partner, K9 River, graduated Tuesday as one of three teams joining the Ohio Department of Natural Resources' K9 program.

The department recognized the teams at the Spring Valley Education Center, according to its [Nov. 10 announcement]({k9_url}). Butler is assigned to Erie County.

River is a male black Labrador retriever purchased from Five T K9 Enterprises. Butler joined the department in 2018 and began field service in 2019, the agency said.

The department says its K9 teams help with tracking, evidence detection, public outreach and education. The announcement does not give a separate start date for Butler and River's work together in Erie County.

The other graduates were wildlife officer Gus Kiebel and K9 Gar, assigned to Adams County, and natural resources officer D'Angelo Thigpen and K9 Frank, based at Rocky Fork State Park.''',
         source_urls=[k9_url],
         notes='Nov. 10 release and ceremony date verified in rendered official browser page. No claim that River is Erie County\'s first K9, no training duration or deployment date inferred. Subject photo requires permission.'),
    dict(key='leadership', slug='leadership-huron-county-2027-applications-january-31',
         section='business', community='Huron County',
         headline='Leadership Huron County opens applications for 2027 class',
         summary='Adults who live or work in Huron County can apply by Jan. 31. Tuition is $1,000, with limited scholarship assistance available.',
         body=f'''Adults who live or work in Huron County can apply by Jan. 31 for Leadership Huron County's 2027 class, a program with $1,000 tuition and monthly sessions from March through December.

The Huron County Growth Partnership [announced the application opportunity Wednesday]({lead_url}), encouraging local employers to sponsor participants.

The [2027 application packet]({application}) says classes run from 8:30 a.m. to 4:30 p.m., generally on the second Thursday of each month. The program begins March 11 and ends Dec. 9. The calendar is tentative, and attendance at the first session is required.

Participants study county issues, visit local organizations and develop leadership skills, according to the packet. Applicants are selected based on their completed applications, leadership potential, contribution to the class and ability to commit the required time.

Tuition is billed after acceptance and is due March 11. Limited scholarship assistance is available; applicants seeking help should notify program consultant Susan Root Moore when they apply.

Completed applications can be emailed to susanroot.moore@gmail.com or mailed to Leadership Huron County, care of Susan R. Moore, 320 Willow Drive, Plymouth, Ohio 44865. The packet says applications received after Jan. 31 will be considered only if space remains.''',
         source_urls=[lead_url, application],
         notes='Announcement dated Nov. 11, 2026. Linked seven-page packet has a future-dated Dec. 1, 2026 cover letter; do not treat that as today\'s announcement date. Application itself repeatedly identifies 2027, Jan. 31 receipt deadline, $1,000 tuition and March 11-Dec. 9 dates. No enrollment guarantee or scholarship award promised. Read all seven pages.'),
    dict(key='milan', slug='milan-council-holiday-meeting-changes-november-december-2026',
         section='government', community='Milan',
         headline='Milan moves holiday council meetings to Nov. 18 and Dec. 16',
         summary='Both meetings start at 6 p.m. at 11 S. Main St. The village asks residents seeking agenda time to email the fiscal officer 48 hours ahead.',
         body=f'''Milan Village Council has moved its November and December meetings to Nov. 18 and Dec. 16 because of the Thanksgiving and Christmas holidays.

Both meetings will begin at 6 p.m. in the Council Room at 11 S. Main St., according to the village's [holiday meeting notice]({milan_url}). The November meeting is next Wednesday.

The meetings are open to the public. Residents seeking to be placed on the agenda should email fiscal officer Cathy Ramey at fiscal@milanohio.gov at least 48 hours before the meeting, the notice says.

The email should include the resident's name, address and question for council. The village says speakers in the citizen participation portion have up to five minutes on their stated topic.''',
         source_urls=[milan_url],
         notes='Live official notice explicitly identifies both 2026 dates, 6 p.m. and Council Room address. Posting date is absent, so no newly announced claim. Advance notice applies to agenda placement/speaking, not permission to attend. No meeting end time inferred.'),
]

alternates = {
    'k9': ['Butler and K9 River complete ODNR training program', 'ODNR recognizes Erie County wildlife officer and new K9 partner'],
    'leadership': ['Huron County leadership program sets Jan. 31 application deadline', '2027 leadership class seeks adults who live or work in Huron County'],
    'milan': ['Milan sets 6 p.m. council meetings for Nov. 18 and Dec. 16', 'Holiday schedule shifts Milan council meeting dates'],
}
for story in stories:
    story.update(status='ready', image={'status': 'none'})
    assert len(story['summary']) < 160
    draft = '# Headlines\n\n' + '\n'.join(f'{i}. {h}' for i, h in enumerate([story['headline'], *alternates[story['key']]], 1))
    draft += '\n\n# Story\n\n' + story['body'] + '\n\n# Notes\n\n' + story['notes']
    draft += '\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE\n'
    (directory / 'drafts' / (story['key'] + '.md')).write_text(draft, encoding='utf-8')

previous = json.loads((directory.parent / '2026-11-10' / 'research.json').read_text(encoding='utf-8'))
held = previous['held_leads'] + [
    {'topic': 'Monroeville variance hearing Thursday', 'source_url': 'https://www.monroevilleohio.com/', 'missing': 'Homepage confirms Nov. 12 at 6 p.m., 21 N. Main St., storage-building variance at 139 W. Broad St. Obtain case/application and full access details before substantive land-use story; no outcome inferred.'},
    {'topic': 'ODOT Sandusky County traffic advisory', 'source_url': 'https://www.transportation.ohio.gov/travel/driving/traffic-advisories', 'missing': 'Google News shows a five-day-old advisory lead. Retrieve current county advisory before new traffic reporting; search snippet is not evidence.'},
]
packet = dict(date='2026-11-11', scope='Verified research and newsroom drafts; publisher separately authorized local publication, production sync and first-time Facebook queue in this conversation.', compared_against={'articles':138, 'events':112}, stories=stories, events=[], updates=[], featured=[], held_leads=held, new_sources=[{'name':'Leadership Huron County','url':'https://www.leadershiphuroncounty.org/','logged_in_news_sources':True}])
(directory / 'research.json').write_text(json.dumps(packet, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Transcribed from the rendered official release because direct HTTP returns 404.
(directory / 'evidence' / 'k9-browser-excerpts.txt').write_text('''Source: https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/k9-graduation-2026
Read in signed-in Chrome on Nov. 11, 2026 before publisher requested @Browser. Relevant article excerpts transcribed from rendered DOM; direct HTTP failure separately preserved.
ODNR Celebrates Graduation of Three New K9 Teams Serving Ohio’s Natural Resources
November 10, 2026
The ceremony was held November 10 at the Spring Valley Education Center and celebrated three K9 teams representing Parks and Watercraft and Wildlife.
State Wildlife Officer Michele Butler, assigned to Erie County, graduated with K9 River, a male black Labrador Retriever purchased from Five T K9 Enterprises. Butler joined ODNR in 2018 and began field service in 2019.
State Wildlife Officer Gus Kiebel, currently assigned to Adams County, graduated with K9 Gar, a male yellow Labrador Retriever.
Natural Resources Officer D’Angelo Thigpen, stationed out of Rocky Fork State Park and serving the Southwest Unit C region, graduated alongside K9 Frank, a male chocolate Labrador Retriever.
These specially trained teams provide critical support through tracking, evidence detection, public outreach, and education.
Media contact on page: Whitney Higaki, ODNR Office of Communications, whitney.higaki@dnr.ohio.gov; media line 614-202-4756.
''', encoding='utf-8')

(directory / 'evidence' / 'browser-sweep.txt').write_text('''Nov. 11, 2026 read-only browser checks
Chrome before @Browser steering: Erie Health news index Nov. 6 school grant; detail body still absent. ODNR live news index: Nov. 10 K9 graduation has Erie County connection; Nov. 9 Cowan Lake trail outside area, Nov. 6 mast survey statewide. HCGP Nov. 11 leadership page confirms Jan. 31, 2027 deadline and links application PDF.
@Browser after steering: Milan homepage explicitly confirms Nov. 18 and Dec. 16, 2026 at 6 p.m., Council Room, 11 S. Main St.; fiscal@milanohio.gov for 48-hour agenda request. No new posting date supplied.
Leadership Huron County https://www.leadershiphuroncounty.org/: anyone who lives and/or works in Huron County can apply; monthly classes March-December at various locations. Program consultant email susanroot.moore@gmail.com. Current cohort details come from dated HCGP notice and packet rather than undated homepage.
Facebook City of Sandusky: newest visible post thanks veterans; no new service terms verified. Private comments were not used. Sandusky Transit X profile loaded but timeline did not supply a new verified alert. Facebook event search Sandusky Ohio: no results.
Google News Sandusky Ohio: previously covered Cedar Point opening, Upper Sandusky data center outside area, obituaries and Sandusky County ODOT advisory lead. No secondary story supplied publication facts.
No posts, messages, reactions, follows or form submissions made during source checks. Social images were not downloaded.
Scouting rejected www.berlintwp.us: Delaware County, not Erie County. A guessed Huron EMA domain failed DNS and was not adopted as a source.
''', encoding='utf-8')

review = '''# Nov. 11, 2026 news budget

Compared 138 published stories, 112 events and 56 library images. Three verified briefs, zero calendar additions and zero existing-story updates. Research made no database writes. The publisher has authorized local-dev publication, production sync and Facebook queuing in this conversation; outcomes will be recorded separately.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Erie County wildlife officer and K9 River graduate from ODNR program](drafts/k9.md) | Tuesday ceremony with Erie County assignment; Outdoors is thin | Ready; no cleared subject photo |
| 2 | [Leadership Huron County opens applications for 2027 class](drafts/leadership.md) | New Wednesday announcement; Jan. 31 deadline | Ready; no cleared subject photo |
| 3 | [Milan moves holiday council meetings to Nov. 18 and Dec. 16](drafts/milan.md) | First changed meeting is next Wednesday; Government is thin | Ready; no cleared subject photo |

K9: [ODNR release](https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/k9-graduation-2026) explicitly dates the ceremony Nov. 10 and assigns Michele Butler to Erie County. River is a black Labrador retriever. No first-ever, deployment-date or training-length claim. Browser text excerpts are preserved because direct HTTP returns 404.

Leadership: [Nov. 11 announcement](https://huroncountyohio.com/2027lhc/) and linked seven-page application confirm eligibility, $1,000 tuition, limited scholarship assistance, Jan. 31 receipt deadline and March 11-Dec. 9, 2027 class dates. Cover letter is future-dated Dec. 1, 2026; the dated web announcement establishes current invitation. No admission or scholarship promised. Calendar remains tentative. Copy was checked against every relevant application page; application PDF and extracted text retained.

Milan: [official homepage notice](https://milanohio.gov/) gives both 2026 dates, 6 p.m. and Council Room address. No posting date supplied; do not call this newly announced today. Agenda notice is not a requirement for audience attendance. No meeting outcome reported.

## Featured and image opportunities

No matching subject image in the 56-image library. No feature changes or uploads. All three use image.status none and the masthead social preview. A possible permission request, not sent: Ask ODNR communications contact Whitney Higaki, whitney.higaki@dnr.ohio.gov, for a Butler/River graduation photo, capture date, reuse permission and required credit. Do not substitute an unrelated dog.

## Calendar

Zero new calendar entries, including zero today. Existing Nov. 13 preschool screening, Nov. 14 soup event and Nov. 18 Huron conversation remain listed. Milan schedule change is explained as a government service brief. No end times inferred or speculative attendance invitations imported.

## Useful new sources

| Source | Leads supplied | How to use it |
| --- | --- | --- |
| [Leadership Huron County](https://www.leadershiphuroncounty.org/) | Program consultant, general eligibility and monthly class format | Use the dated HCGP announcement and cohort application for year-specific deadlines, costs and schedule. Undated homepage does not announce a new class by itself. |

Update HCGP and ODNR source notes in place. Reject the Berlin Township site in Delaware County as outside coverage; no source entry added for it.

## Held leads and source checks

Yesterday's held leads carried in research.json. School-health grant detail remains empty in the browser; keep held despite $1.5 million title. Bass rule details and Lake Erie exceptions remain unresolved. Monroeville hearing is tomorrow, but full case records were not obtained; no decision inferred. Google News ODOT advisory needs current primary document.

Saved HTTP sweep covered Sandusky, Huron, Milan, Monroeville, county jobs, Erie MetroParks, Sandusky County parks, Ohio Sea Grant, GLCAP, Huron County Growth Partnership, Danbury and Sandusky schools. Health, Perkins, Oberlin, Port Clinton schools and ODNR had HTTP access failures; browser checked the health and ODNR notices. Prior news was not duplicated. Promising source checks included Leadership Huron County and the rejected wrong-county Berlin Township site.

Signed-in social checks used @Browser after publisher steering: City of Sandusky's latest veterans tribute, Transit X profile (timeline incomplete), Facebook event search (no results) and Google News local search. These are targeted checks, not a claim that every listed account was swept. No social interaction or images reused.

## Validation and authorized publication

All three drafts received newsroom Write and Check passes; NONE unresolved flags. No quotes, allegations, placeholders or unverified outcomes. Run packet validation before import. Verify account-linked JD bylines, Newsroom discussions, local pages, production migration parity, exact story rows, section counts and live previews before first-time Facebook delivery. Keep write-intent journals and a separate production record. No version bump, commit or push is needed.
'''
(directory / 'review.md').write_text(review, encoding='utf-8')
print(f'Prepared {len(stories)} verified briefs: {directory}')
