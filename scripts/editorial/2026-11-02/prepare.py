import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory
p = editorial_directory('2026-11-02')
stories = [
 dict(key='offices', slug='sandusky-city-offices-election-day-closure-november-3-2026', section='government', community='Sandusky',
 headline='Sandusky city offices to close Tuesday for Election Day',
 summary='The city announced the Nov. 3 closure and directed voters to the Erie County Board of Elections for voting information.',
 body='''Sandusky city offices will be closed Tuesday, Nov. 3, for Election Day, the city announced Monday.

The city's [official notice](https://x.com/cityofsandusky/status/2117260578506920199) directs residents to the Erie County Board of Elections for voting information. A matching announcement appears on the city's Facebook page.

The [board's website](https://www.boe.ohio.gov/erie/) provides election information, including polling locations, polling hours, absentee ballot rules and sample ballots, according to the city. Residents planning a visit to city offices should account for Tuesday's closure.''',
 source_urls=['https://x.com/cityofsandusky/status/2117260578506920199','https://www.facebook.com/photo/?fbid=1461766846082000&set=a.178941827697848'],
 notes='Urgent service brief. Official X post has Nov. 2, 2026, 9:20 a.m. timestamp; matching Facebook full text read. No inference about police, fire, transit, trash, polling-place access or reopening time.',
 facts='Who: City of Sandusky. What: city offices closed. When: Tuesday, Nov. 3, 2026; announcement Monday at 9:20 a.m. Where: Sandusky. Why: Election Day. How: official city X and Facebook announcements. No direct quotations.'),
 dict(key='pettay', slug='huron-andrew-pettay-full-time-firefighter-october-2026', section='local', community='Huron',
 headline='Huron hires Andrew Pettay as full-time firefighter and paramedic',
 summary='Pettay joins Shift 2 at Station 1 after part-time service in Huron and 7 1/2 years working full time in Sandusky.',
 body='''Huron has hired Andrew Pettay as a full-time firefighter and paramedic after he served part time with the city, according to an Oct. 28 announcement.

Pettay joins Shift 2 at Station 1 under Capt. Kurt Schafer, the city said in its [hiring announcement](https://www.cityofhuron.org/news_detail_T3_R74.php).

He had worked part time with Huron since February and spent 7 1/2 years working full time in Sandusky, according to the city.

Fire Chief Kevin McGraw said in the announcement that he had worked with Pettay in Sandusky while McGraw was a lieutenant. The announcement does not give Pettay's full-time start date.''',
 source_urls=['https://www.cityofhuron.org/news_detail_T3_R74.php'],
 notes='Oct. 28 is the announcement date, not an inferred start date. No net-staffing, response-time, budget or job-creation claim. Personal family details and promotional language omitted. City photographs are not licensed for reuse.',
 facts='Who: Andrew Pettay, firefighter and paramedic; Fire Chief Kevin McGraw; Capt. Kurt Schafer. What: full-time Huron hire, Shift 2, Station 1. When: announced Oct. 28, 2026; prior part-time service since February. Background: 7.5 years full time with Sandusky, per city. No direct quotations.'),
 dict(key='careers', slug='huron-county-business-school-career-programs-2026-27', section='schools', community='Huron County',
 headline='Huron County seeks employers for student career programs',
 summary='Businesses can host student visits, share career experience or join a May 2027 job fair through the county business advisory council.',
 body='''Huron County employers can host student workplace visits and take part in school career programs during the 2026-27 school year, according to the Huron County Growth Partnership.

The partnership's [Oct. 30 report](https://huroncountyohio.com/bac2026/) invites businesses to work with the county Business Advisory Council, which connects schools with local employers. Opportunities include career camps and a senior job fair scheduled for May 11, 2027, at Norwalk High School.

The partnership says it is coordinating four career camps this school year. Businesses can host tours, demonstrate work processes or speak with students about their jobs.

Bellevue High School is also hosting a regional senior leadership event called The Pinnacle in November, according to the report. Professionals can share their experience and help students explore options after graduation. The report does not give that event's date or participation deadline.

Employers hiring seniors can attend the May job fair with current openings and staff prepared to discuss pay, benefits and qualifications. The partnership also describes an August teacher boot camp in which educators visit businesses to learn about workplaces and career paths.

The council's next listed meeting is Nov. 20 in Greenwich, Huron County. The report does not supply a meeting time or street address.

Businesses of all sizes can contact Troy Parks at tparks@huroncountyohio.com or 419-668-4155 to join the council or discuss hosting a meeting, arranging student experiences or participating in other programs.''',
 source_urls=['https://huroncountyohio.com/bac2026/'],
 notes='Fresh Oct. 30 employer invitation. Existing council, not a new launch or a claim of filled jobs. March pitch dates lack an explicit year in the prose and are omitted. November Pinnacle date and council venue/time are explicitly not supplied; contact provided. No participation deadline or cost inferred.',
 facts='Who: Huron County Growth Partnership, county Business Advisory Council, contact Troy Parks. What: employer participation, four 2026-27 camps; Pinnacle November at Bellevue High School; senior job fair May 11, 2027 at Norwalk High School. Next council meeting Nov. 20, 2026 Greenwich, no time/venue. Why: connect students and local employers. How: contact Parks. No direct quotations.')
]
alternatives={
 'offices':['Sandusky announces Nov. 3 city-office closure','Election Day closure set for Sandusky city offices'],
 'pettay':['Andrew Pettay moves to full-time role with Huron Fire','Huron adds Pettay to full-time fire crew at Station 1'],
 'careers':['Huron County invites businesses to help students explore careers','Employers sought for Huron County career camps and senior job fair']
}
for s in stories:
 s.update(status='ready',image={'status':'none','notes':'Library searched; no suitable cleared subject photo. Use masthead social preview. No social or city photos reused.'})
 (p/'drafts'/f"{s['key']}.md").write_text('# Headlines\n\n'+'\n'.join('- '+h for h in [s['headline']]+alternatives[s['key']])+'\n\n# Story\n\n'+s['body']+'\n\n# Notes\n\nStory type: brief / announcement rewrite.\n\n'+s.pop('facts')+'\n\n'+s['notes']+'\n\n# Flags\n\nNONE\n\n# Newsroom Check mode\n\nNONE\n',encoding='utf-8')
events=[
 dict(key='food',slug='perkins-thanksgiving-food-drive-november-13-2026',status='ready',title='Perkins Thanksgiving food drive',summary='Donate nonperishable food for local families at Walmart on Milan Road.',description='Perkins Township will collect nonperishable food for local families from 10 a.m. to 4 p.m. Nov. 13. Its Nov. 2 announcement also says donations can be left in the Perkins Police lobby at any time. The notice does not give a Walmart street number or identify recipient organizations.',category='community',starts_on='2026-11-13',start_time='10:00',ends_on=None,end_time='16:00',hours_note='',venue='Walmart Sandusky',address='Milan Road, Suite 200',community='Perkins Township',organizer='Perkins Township',organizer_url='https://perkinstownship.com/',cost='Food donations requested',source_url='https://perkinstownship.com/annual-food-drive/',image={'status':'none'},notes='Calendar candidate only; not imported in this story-only publication. Browser full text verified year/time. No invented street number.'),
 dict(key='dark',slug='ohio-clean-marinas-dark-skies-webinar-november-4-2026',status='ready',title='Dark Skies at Marinas webinar',summary='Ohio Sea Grant hosts an online program on outdoor lighting and light pollution.',description='Bryan Boulanger of DarkSky Ohio will discuss light pollution and responsible outdoor lighting. Organizer registration link: https://go.osu.edu/winterwebinarseries. Confirm access terms with the organizer; no fee is stated on the event page.',category='classes',starts_on='2026-11-04',start_time='13:00',ends_on=None,end_time='13:30',hours_note='',venue='Online',address='',community='Lake Erie region',organizer='Ohio Sea Grant / Ohio Clean Marinas',organizer_url='https://ohioseagrant.osu.edu/',cost='Not stated; registration required',source_url='https://ohioseagrant.osu.edu/news/calendar/2026/11/04/ememl/dark-skies-at-marinas',image={'status':'none'},notes='Calendar candidate only; not imported. The primary event page explicitly supplies Nov. 4, 2026, 1-1:30 p.m. Do not infer free access.')
]
previous=json.loads((editorial_directory('2026-10-31')/'research.json').read_text(encoding='utf-8'))
held=previous['held_leads']+[dict(topic='Milan holiday council meeting changes',source_url='https://www.milanohio.gov/',missing='Ready source lead for Nov. 18 and Dec. 16, 2026 at 6 p.m., Council Room, 11 S. Main St. Separate calendar decision; not a new story today. Leaf notice lacks year and must not be inferred from adjacent 2026 notices.'),dict(topic='Sandusky County budget reports',source_url='https://sanduskycountyoh.gov/',missing='Secondary budget-gap/payroll allegations require original county/state correspondence, independent verification and responses. Not used as fact.'),dict(topic='Clean Marinas Nov. 5 and Nov. 10 workshops',source_url='https://ohioseagrant.osu.edu/news/calendar/2026/11/05/kra5y/ohio-clean-marinas',missing='Event page repeats 1 p.m. as start/end while narrative says two hours. Confirm exact ending and registration terms before calendar import.')]
packet=dict(date='2026-11-02',scope='Publisher explicitly requested local story import, production sync and Facebook queue. Calendar candidates retained for review only; publication results recorded separately.',compared_against={'articles':111,'events':112},stories=stories,events=events,updates=[],featured=[],held_leads=held,new_sources=[dict(name='Village of Milan official website',url='https://www.milanohio.gov/',logged_in_news_sources=True)])
(p/'research.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(p/'review.md').write_text('''# Nov. 2, 2026 news budget

Compared 111 published stories, 112 events and 56 library images. Three verified stories selected for the publisher's requested local-dev import, production sync and Facebook queue. Two calendar candidates remain for review only. This packet was prepared before import; final outcomes will be recorded in production-publication.md.

## First action: Election Day office closure

Sandusky posted its [city-office closure](https://x.com/cityofsandusky/status/2117260578506920199) Monday at 9:20 a.m. Eastern. Closure is Tuesday, Nov. 3. Matching [Facebook announcement](https://www.facebook.com/photo/?fbid=1461766846082000&set=a.178941827697848) read in full. Do not infer changes to emergency response, transit, trash, polling places or reopening hours.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Sandusky city offices to close Tuesday for Election Day](drafts/offices.md) | Tomorrow's service closure; government section thin | Ready; no suitable cleared photo |
| 2 | [Huron County seeks employers for student career programs](drafts/careers.md) | Oct. 30 call, 2026-27 camps and November participation opportunities; schools thin | Ready; no suitable cleared photo |
| 3 | [Huron hires Andrew Pettay as full-time firefighter and paramedic](drafts/pettay.md) | Uncovered Oct. 28 city announcement | Ready; city images need permission |

The [career report](https://huroncountyohio.com/bac2026/) supplies four school-year camps, a May 11, 2027 Norwalk job fair and contact Troy Parks. Do not turn the existing council into a new launch or infer a year for undated March pitch events. The November meeting lacks a time and address; Pinnacle lacks a day. Copy tells readers what is missing.

The [Huron announcement](https://www.cityofhuron.org/news_detail_T3_R74.php) establishes the hire, shift, station and past service. Oct. 28 is publication, not a confirmed full-time start date. Personal family details and publicity language omitted. All three newsroom drafts have fact inventories, three headline options and Check mode results without unresolved flags.

## Potential calendar additions

| Event | Date and time | Place | Cost, registration and checks |
| --- | --- | --- | --- |
| [Dark Skies at Marinas](https://ohioseagrant.osu.edu/news/calendar/2026/11/04/ememl/dark-skies-at-marinas) | Wednesday, Nov. 4, 1-1:30 p.m. | Online | Registration required; fee not stated |
| [Perkins Thanksgiving food drive](https://perkinstownship.com/annual-food-drive/) | Nov. 13, 10 a.m.-4 p.m. | Walmart, Milan Road, Suite 200 | Nonperishable food for local families; police lobby also accepts donations at any time |

No new candidate happens today. Today's All Souls Day Mass/open house is already listed. Calendar candidates are not part of the requested story publication; retain for a separate calendar decision. No event-only lead padded into a story.

## Images and featured stories

Existing library searched. No suitable cleared photo selected for these three subjects. Huron's supplied photographs are publicly viewable but lack reuse permission. No images downloaded from social platforms, no R2 uploads and no featured-story change. Masthead previews are appropriate. If a portrait is wanted, draft request to Huron's city contact: May Firelands Current reuse the Andrew Pettay hiring photograph for this story and social preview, with the photographer's credit and capture date? No request sent.

## Useful new sources

| Source | Leads supplied | How to use it |
| --- | --- | --- |
| [Village of Milan](https://www.milanohio.gov/) | Holiday council changes, utilities and office notices | Current Events announcements give Nov. 18 and Dec. 16, 2026, 6 p.m., 11 S. Main St.; verify each notice's own year |

Logged Milan as a reference source in docs/news-sources.md. Its adjacent leaf paragraph has no year; do not use it as proof of 2026 collection dates. No commit or push.

## Held leads and source checks

Earlier holds carried forward in research.json, including Perkins demolition appeal, CACEHR season conflict, invasive buyback year, KFC closure and library-format conflict. No unverified update to earlier coverage. GLCAP's current homepage still agrees with the existing Nov. 2-4 board nomination report. Camp Street's newer resurfacing status was already incorporated Oct. 31.

Primary sweep preserved pages for Sandusky, Huron, schools, Perkins, Sea Grant, MetroParks, Huron County partnership, GLCAP, Monroeville, Vermilion schools, BGSU Firelands, Ottawa refuge, Norwalk calendar, Huron County Public Health, Castalia, Oak Harbor and Milan. Some health, partnership, Oberlin, airport and school requests failed; failures do not establish no news. Greater Sandusky's readable web result still leads with the already-covered grants. Vermilion's new website is a lesser service lead; BGSU's archive is stale. No claim to have exhaustively checked every directory source.

Signed-in social: official Sandusky Facebook and X supplied the closure; ErieCoHealthOhio's visible top nurse-recruitment post duplicates Oct. 31 coverage. An initially tried health handle was unavailable; the current handle was then taken from the source directory. Facebook event search returned no results. Google News surfaced the previously held KFC closure and traffic/obituary leads; secondary reporting was not reused. Wider search also surfaced Sandusky County budget allegations; held for original records and responses.

Clean Marinas workshops have repeated start/end fields and two-hour narrative; exact ending held. Milan holiday meeting changes retained as further calendar leads. No allegation or private social comment used as fact.

## Evidence and validation

Primary HTML/text, fetch timestamps and hashes saved under evidence. Browser-only source transcriptions retain URLs, date and context. Local import and production utilities will retain before snapshots, SQL hashes, write journals, live-page checks and Facebook status. No source-copy or story text saved to logs outside this project packet. No messages sent or social reactions made.
''',encoding='utf-8')
print('Prepared 3 story drafts, 2 calendar candidates and carried-forward holds')
