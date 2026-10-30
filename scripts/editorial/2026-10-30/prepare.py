import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

p = editorial_directory('2026-10-30')
assert not (p / 'local-import-pending.json').exists(), 'Inspect import journals before preparing again'
assert not (p / 'local-import.json').exists(), 'Packet already imported'
text='''Source: https://perkinstownship.com/leaf-pickup-2/
Checked Oct. 30, 2026 in signed-in in-app browser. Direct requests returned 403.
Rendered notice, dated OCTOBER 29, 2026, by Ashley Ohlemacher:
Leaf collection is scheduled each year in the fall. The leaf truck travels through the Township on a rotating basis through zones. Weather permitting, the leaf pick-up program will typically continue through December. October 29, 2026 Daily leaf pick-up will begin Monday, November 2nd. We have begun random pickups. If you see the truck and your leaves aren’t out, don’t worry, we will be through all neighborhood’s multiple times! A daily Facebook post will be made on where the truck is expected to begin each day. The collections will be done on a rotating basis and determined by zones (NEW THIS YEAR!). To determine your zone, please visit our website at: https://perkinstownship.com/public-works/leaf-collection/ We will make multiple passes through the Township. Collections will continue until leaves are removed from the neighborhoods provided that the weather cooperates. An update on where the truck will be is posted on our Facebook page each morning. We will do our best to be as accurate as possible.
Leaves should be placed along the property owner’s lot within four (4) feet of the curb.
Do not place leaves in the street, on the curb, or near gutters to ensure that drainage is not affected.
Leaf piles must be free of debris such as plant materials and sticks to prevent damage to the leaf trucks.
If leaf piles contain debris, we will be unable to collect them.
Do not place leaves in any bags, including paper bags.
Please move vehicles parked in front of leaves. If vehicles block the leaves, we cannot collect them. For questions about the Township’s Leaf Collection Program please contact the Public Works Department between the hours of 7:30am and 3:00pm @ 419-609-1433.
'''
(p/'evidence/perkins-leaf-browser.txt').write_text(text,encoding='utf-8')
stories=[dict(key='choir',slug='sandusky-choir-white-house-trip-foundation-grant-october-2026',section='schools',community='Sandusky',headline='Sandusky choir receives $10,000 grant for White House trip',summary='The Erie County Community Foundation grant will help cover travel, lodging and meals for the high school Keynotes & Bell Choir.',body='''Sandusky High School's Keynotes & Bell Choir has received a $10,000 grant to help pay for a trip to perform at the White House, Sandusky City Schools announced Thursday.

The Erie County Community Foundation award will help cover transportation, lodging and meals, according to the [district's Oct. 29 release](https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIYYUY). The district says its goal is for participating students to make the trip without a cost to their families while limiting the expense to the district.

The choir has been invited to perform at the First Lady's Christmas at the White House in Washington, according to the release. It does not give a performance date, the number of students traveling or the trip's total cost.

Students have been preparing Christmas music for several weeks, the district says. Transporting the choir's bells and other musical equipment is among the trip's needs.

The district is seeking additional community contributions and directs donors to [Sandusky Sings](https://www.sanduskysings.com/), which links to the choir's trip fundraiser. The release says additional support may also help students visit historic sites and landmarks during the trip.''',source_urls=['https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIYYUY','https://www.sanduskysings.com/'],notes='New Oct. 29 grant, not an independently confirmed new White House invitation. All invitation claims attributed to district; omit promotional selection claims. No performance date, traveler count or total budget supplied. Fundraiser totals omitted because live and distinct from grant.'),dict(key='leaves',slug='perkins-leaf-pickup-new-zones-november-2-2026',section='local',community='Perkins Township',headline='Perkins leaf pickup starts Monday with new collection zones',summary='The township plans repeated passes as weather allows and asks residents to leave loose leaves within 4 feet of the curb.',body='''Daily leaf pickup in Perkins Township will begin Monday, with crews rotating through new collection zones and making repeated passes as weather allows, the township says.

The Erie County township's [Oct. 29 notice](https://perkinstownship.com/leaf-pickup-2/) says some pickups have already begun. Residents who see a truck before their leaves are ready will have more chances to have them collected.

The township plans to post each morning on its [official Facebook Page](https://www.facebook.com/PerkinsTownship) where the truck is expected to begin. Weather can affect collection, which typically continues through December; the notice gives no fixed final pickup date.

Residents should place loose leaves on their property within 4 feet of the curb. Leaves must stay out of the street, off the curb and away from gutters so they do not interfere with drainage.

Do not bag the leaves, even in paper bags. Keep sticks and other plant material out of the piles: the township says debris can damage its trucks, and crews cannot collect contaminated piles.

Vehicles must be moved if they block access to the leaves.

The notice directs residents to the township's [leaf collection page](https://perkinstownship.com/public-works/leaf-collection/) to identify their zone. Questions can go to the Public Works Department at 419-609-1433 between 7:30 a.m. and 3 p.m.''',source_urls=['https://perkinstownship.com/leaf-pickup-2/'],notes='Monday is Nov. 2, 2026. The dated notice explicitly calls zones new. No zone boundaries transcribed from an unread map; readers linked to official lookup. No guaranteed route dates or collection end inferred.'),dict(key='warmchoice',slug='glcap-warmchoice-weatherization-local-home-improvements-october-2026',section='community',community='Firelands region',headline='GLCAP highlights no-cost weatherization available in Firelands counties',summary='The agency reports 1,097 WarmChoice-supported projects across Ohio in 2025. Eligible local Columbia Gas customers can seek home improvements.',body='''Eligible Columbia Gas customers in Erie, Huron, Ottawa and Sandusky counties can seek no-cost home weatherization through WarmChoice, a program highlighted in a new Great Lakes Community Action Partnership report.

The Fremont-based agency's [Oct. 28 report](https://www.glcap.org/blog/weatherization-day-showcases-warmchoice-program/) says WarmChoice supported 1,097 Home Weatherization Assistance Program projects across Ohio in 2025. That is a statewide figure, not a count of homes served locally.

The report follows a Tuesday demonstration at a home in Hebron, outside the Firelands area. Great Lakes Community Action Partnership, Columbia Gas of Ohio and LEADS Community Action Agency hosted the event to show how weatherization works.

Locally, the partnership's [WarmChoice service page](https://www.glcap.org/warmchoice) lists Erie, Huron, Lorain, Ottawa and Sandusky counties among the counties it serves directly. The year-round service is available to qualified Columbia Gas customers, including income-eligible homeowners and renters.

Services may include a home energy inspection, attic and wall insulation, air sealing, appliance safety checks and repair or replacement of natural gas furnaces and water heaters. Eligibility and the home's needs determine what assistance is provided; the announcement does not promise a particular reduction in bills.

Residents can use the application link on the service page or call Great Lakes Community Action Partnership at 800-775-9767 for information.''',source_urls=['https://www.glcap.org/blog/weatherization-day-showcases-warmchoice-program/','https://www.glcap.org/warmchoice'],notes='New Oct. 28 report is the news peg. Existing year-round service, not a new application window or emergency-bill program. 1,097 is statewide 2025, not local or 2026. Avoid dollar income thresholds from broad HWAP release without WarmChoice-specific confirmation.')]
alternatives={'choir':['Foundation awards $10,000 toward Sandusky choir trip','Grant helps Sandusky students prepare for White House performance'],'leaves':['Perkins adds zones as daily leaf pickup begins Monday','Perkins sets loose-leaf pickup rules for fall collection'],'warmchoice':['Weatherization report points local households to WarmChoice','GLCAP reports 1,097 WarmChoice-supported projects statewide in 2025']}
facts={'choir':'Who: Sandusky City Schools, high school Keynotes & Bell Choir, Erie County Community Foundation. What: $10,000 grant. When: Oct. 29 release; performance date not supplied. Where: White House, Washington. Why/how: travel, lodging, meals and instrument transport; family-cost goal and donor link supplied. Quotes: none used.','leaves':'Who: Perkins Township. What: daily pickup begins with new zones. When: Monday, Nov. 2, in Oct. 29 notice. Where: Erie County township. How: rotating repeated passes, weather dependent; loose leaves within 4 feet; no bags or debris; vehicles moved; Public Works phone and hours. Quotes: none used.','warmchoice':'Who: GLCAP, Columbia Gas, LEADS CAA. What: statewide weatherization report and existing local access. When: Oct. 28 report, Oct. 27 demonstration, 2025 project total. Where: demonstration Hebron; verified local service counties on program page. How: qualified Columbia Gas homeowners/renters apply via provider. Quotes: none used.'}
for s in stories:
 s.update(status='ready',image={'status':'none','notes':'No cleared photograph depicting this announcement. Standard masthead social preview.'})
 out='# Headlines\n\n'+ '\n'.join('- '+x for x in [s['headline']]+alternatives[s['key']])+'\n\n# Story\n\n'+s['body']+'\n\n# Notes\n\n'+facts[s['key']]+'\n\n'+s['notes']+'\n\n# Flags\n\nNONE\n\n# Newsroom Check mode\n\nNONE\n'
 (p/'drafts'/f"{s['key']}.md").write_text(out,encoding='utf-8')
previous=json.loads((editorial_directory('2026-10-29') / 'research.json').read_text(encoding='utf-8'))
held=previous['held_leads']
held += [{'topic':'Vermilion health services','source_url':'https://www.facebook.com/ErieCoHealthOhio','missing':'Earlier social lead not independently resolved; visible top post remains the already-covered pantry. No service-change claim published.'},{'topic':'Ohio job metrics','source_url':'https://news.google.com/','missing':'New secondary headline needs dated primary labor data and locally relevant comparison before coverage.'}]
packet={'date':'2026-10-30','scope':'Verified budget, local import, production sync and first-time Facebook queue authorized by publisher in this chat; publication results recorded separately.','compared_against':{'articles':105,'events':112},'stories':stories,'events':[],'updates':[],'featured':[],'held_leads':held,'new_sources':[{'name':'Sandusky Sings / choir trip fundraiser','url':'https://www.sanduskysings.com/','logged_in_news_sources':True}]}
(p/'research.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
review='''# Oct. 30, 2026 news budget

Compared 105 published stories, 112 events and 56 library images against yesterday's packet. Three ready new briefs; no new verified calendar additions or updates to existing coverage. Publisher authorized local dev, production sync and Facebook queuing in this chat. This packet precedes import; publication outcomes will be recorded separately.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Perkins leaf pickup starts Monday with new collection zones](drafts/leaves.md) | Oct. 29 notice, Monday start and changed zones | Ready; no cleared subject image |
| 2 | [Sandusky choir receives $10,000 grant for White House trip](drafts/choir.md) | Oct. 29 grant release; thin schools section | Ready; no cleared performance image |
| 3 | [GLCAP highlights no-cost weatherization available in Firelands counties](drafts/warmchoice.md) | Oct. 28 report, verified local service access before winter | Ready; no cleared project image |

[Perkins' dated notice](https://perkinstownship.com/leaf-pickup-2/) was read in the signed-in browser after direct requests returned 403. Relevant rendered notice retained in evidence/perkins-leaf-browser.txt. New zones are explicit; no neighborhood boundary or daily route is guessed. Typical December continuation is weather dependent, not an end-date guarantee.

[The district's grant release](https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIYYUY) establishes the new $10,000 award. White House invitation and family-cost goal remain attributed to the district. No performance date, student count or total trip budget supplied. [Sandusky Sings](https://www.sanduskysings.com/) resolves to the linked trip fundraiser; volatile totals omitted.

[GLCAP's report](https://www.glcap.org/blog/weatherization-day-showcases-warmchoice-program/) gives the 1,097 statewide projects in 2025; its [service page](https://www.glcap.org/warmchoice) verifies local counties, qualified customer access and year-round service. Hebron demonstration is outside coverage; local service is the reader impact. Not presented as a new benefit or a winter-crisis application window. No dollar income cutoff or predicted savings published.

Each draft includes a fact inventory, three headline options, Newsroom Write output and Check mode with no unresolved flags.

## Images and featured stories

Reviewed baseline library metadata. An existing Sandusky High School exterior could illustrate the building, but no cleared choir performance, Perkins collection or weatherized home photograph was identified. No website or social photos reused. All three stories use the masthead preview; no change to featured selections recommended.

## Calendar and existing coverage

No new calendar additions, including no new event today. Halloween listings are already present. Camp Street still shows the Oct. 14 schedule; X still has the Oct. 17 planned paving dates, not completion. No Perkins appeal outcome verified. Existing copy left unchanged.

## Useful new sources

| Source | Leads supplied | How to use it |
| --- | --- | --- |
| [Sandusky Sings](https://www.sanduskysings.com/) | District-linked choir trip fundraiser | Confirm redirect and organizer through district release; live totals change and are separate from foundation awards |

Logged the fundraiser in docs/news-sources.md and added the new Perkins leaf notice and GLCAP service-page guidance in place. Sources scouted for thin sections: BGSU Firelands (latest campus news August), Oak Harbor, choir fundraising and GLCAP housing services. No stale campus item promoted as new.

## Held leads and source checks

Carried forward Christmas assistance notification conflict, Winter Crisis season/appointment conflict, invasive buyback year, Camp Street and demolition-appeal outcomes. New secondary job-metrics headline held for primary data. No damaging allegations reused. Monroeville, GSP grants, volunteers and boat-wrap reporting are duplicates.

Primary sweep: Sandusky, Sandusky schools, Perkins, GLCAP, Ohio Sea Grant, Erie MetroParks, Huron County Growth Partnership, Huron city, Monroeville, Catholic parishes, CACEHR, BGSU Firelands, Oak Harbor and Port Clinton schools. Health and GSP direct requests returned 403; web reader supported archive checks. Port Clinton schools returned 503. Access failure does not establish no news. This is a targeted sweep, not every source in the directory.

Signed-in social: city Facebook still led with pathway mixer; health Facebook led with the already-covered pantry. City X showed Oct. 26 commission notice and older Halloween/paving posts. Google News surfaced old Koch acquisition, a dredging photo and a new job-metrics headline; none independently supplied another ready story. Facebook events checked separately; no listing used without organizer verification. No reactions, comments, follows, submissions or messages.

## Evidence and validation

Primary HTML, extracted text, checked times and hashes retained under evidence/; browser-only leaf instructions saved as a rendered excerpt. No image permission request sent. Publication utility will retain exact SQL, before snapshots, write-intent journals and live verification. No code deployment, commit, push or version bump is part of this content work.
'''
(p/'review.md').write_text(review,encoding='utf-8')
print('Prepared 3 drafts and review packet')
