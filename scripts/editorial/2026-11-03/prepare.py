"""Prepare verified copy and source notes for the publisher's November 3 run."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

p = editorial_directory('2026-11-03')
assert not (p / 'local-import.json').exists()
baseline = json.loads((p / 'evidence/existing-content.json').read_text(encoding='utf-8'))
previous = json.loads((editorial_directory('2026-11-02') / 'research.json').read_text(encoding='utf-8'))

transit_url = 'https://x.com/SanduskyTransit/status/2117270967651066028'
jobs_url = 'https://www.portclinton.com/services__/employment__opportunities.php'
job_post = 'https://www.facebook.com/PortClintonOH/posts/pfbid0ShGkLfRKeUFtphivAPT7FmSuyAM32z425AEEEALDaMeWbmwvzwsLMzNt18cEwmNKl'
job_pdf = 'https://www.portclinton.com/Water%20Distribution_Wastewater%20Collection%20Operator,%20Utility%20Dept.%20102126.pdf?t=202611020934320'
winter_url = 'https://www.glcap.org/blog/winter-crisis-program-now-underway-for-2026-2027-season/'
photo_url = 'https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG'
photo = next(m for m in baseline['media'] if m['id'] == '733286ca-e923-4c65-9952-8cac1a5ce602')

stories = [
    dict(key='yellow', slug='sandusky-transit-yellow-line-off-season-hours-november-2026', section='local', community='Sandusky',
         headline='Sandusky Transit Yellow Line switches to off-season hours',
         summary='The Yellow Line now runs Monday through Saturday, 6:30 a.m. to 8:30 p.m., under the schedule that took effect Nov. 1.',
         body=f'''Sandusky Transit's Yellow Line is running from 6:30 a.m. to 8:30 p.m. Monday through Saturday under an off-season schedule that took effect Sunday, Nov. 1.

The agency announced the change Monday in an [official service alert]({transit_url}). Riders planning Yellow Line trips should use those operating days and hours.

The alert applies to the Yellow Line. It does not announce changes to other routes or give a date for the next seasonal schedule change.

Route information is available through the city's [transit maps and schedules](https://www.cityofsandusky.com/community/sandusky_transit_system/maps___schedules.php).''',
         source_urls=[transit_url], image={'status':'none'},
         notes='New Nov. 2 official alert, effective Nov. 1; opened individual X post and verified full Nov. 2, 2026 date. No comparison with unverified summer hours. No suitable licensed bus photograph.',
         facts='Who: Sandusky Transit. What: Yellow Line off-season schedule. Effective: Nov. 1. Hours: Monday-Saturday, 6:30 a.m.-8:30 p.m. Source publication: Nov. 2, 2026, 10:01 a.m. No expiry, fare change or other-route change given.',
         alternatives=['Yellow Line now runs 6:30 a.m. to 8:30 p.m. Monday through Saturday', 'Sandusky Transit announces Yellow Line seasonal schedule']),
    dict(key='operator', slug='port-clinton-utility-operator-applications-november-16-2026', section='business', community='Port Clinton',
         headline='Port Clinton seeks utility operator; applications due Nov. 16',
         summary='The city is accepting applications until noon Nov. 16 for a full-time water distribution and wastewater collection operator.',
         body=f'''Port Clinton is accepting applications until noon Nov. 16 for a full-time water distribution and wastewater collection operator in its Utility Department.

The city's [employment listing]({jobs_url}), posted Monday, links the application and job description. Its [recruitment announcement]({job_post}) lists a Monday-through-Friday schedule of 7 a.m. to 3 p.m., with some overtime.

The announcement lists a pay range of $30.44 to $36.32 depending on experience, but does not specify the pay period.

Applicants should confirm certification requirements with the city. The recruitment announcement accepts Ohio Environmental Protection Agency Water Distribution I or Wastewater Collection I certification or higher. The linked [position description]({job_pdf}) instead lists Water Distribution I or higher and obtaining Wastewater Collection I or higher. Both allow a year to obtain a commercial driver's license.

The job description calls for a high school education or equivalent and experience in construction or street, water or sewer maintenance and repair.

Applications may be delivered to City Hall, mailed to Port Clinton City Hall, Attn: Sandye Chafee, 1868 E. Perry St., Port Clinton, Ohio 43452, or emailed to pcadmin@portclinton-oh.gov. The deadline is noon Nov. 16.''',
         source_urls=[jobs_url, job_post, job_pdf], image={'status':'none'},
         notes='New Nov. 2 city listing. Published copies explicitly disclose certification disagreement and missing pay period; do not infer hourly pay, a new position, vacancy count or hiring shortage. No suitable cleared image.',
         facts='Who: Port Clinton Utility Department. Full-time water distribution/wastewater collection operator. Posted Nov. 2, deadline noon Nov. 16, 2026. Monday-Friday 7 a.m.-3 p.m., some overtime. Pay $30.44-$36.32, period unstated. Social accepts either certification; PDF lists water and obtaining wastewater certification. Mail/in-person/email routes verified. PDF page 1 visually inspected.',
         alternatives=['Port Clinton opens applications for full-time utility job', 'Utility operator applications due Nov. 16 in Port Clinton']),
    dict(key='leaves', slug='norwalk-leaf-pickup-curb-deadline-november-16-2026', section='local', community='Norwalk',
         headline='Norwalk leaves must be at the curb by 7 a.m. Nov. 16',
         summary='The city schedules one pass during Nov. 16-20. Leaves must be loose, within 6 feet of the curb and clear of parked cars.',
         body=f'''Norwalk residents must have leaves at the curb by 7 a.m. Nov. 16 for the city's leaf pickup, scheduled for Nov. 16-20.

The city says crews will collect leaves only once, according to the instructions on its [city calendar](https://www.norwalkoh.com/city-calendar). Residents should place leaves where their trash is collected and within 6 feet of the curb.

Leaves must be loose. The city will not pick up bagged leaves or piles mixed with brush, sticks, other yard waste or trash. Parked cars must not block access to the piles.

The [individual pickup listing](https://www.norwalkoh.com/city-calendar/2020/11/30/leaf-pick-up) confirms the Nov. 16-20, 2026, collection week. The city's instructions set the 7 a.m. deadline; the calendar's broader time range does not give a pickup appointment for each address.

*File photo: [OHWiki / Wikimedia Commons / Public domain]({photo_url}). West Main Street in downtown Norwalk; photograph uploaded July 18, 2008. It does not show this year's leaf collection.*''',
         source_urls=['https://www.norwalkoh.com/city-calendar','https://www.norwalkoh.com/city-calendar/2020/11/30/leaf-pick-up'],
         image=dict(status='library',media_id=photo['id'],source_url=photo_url,license='Public domain',license_url=photo_url,credit=photo['credit'],caption=photo['caption'],alt=photo['alt'],placement='lead'),
         notes='Distinct from earlier brush/yard-waste and large-item stories. Calendar header confirms 2026 despite 2020 URL. Instructions appear on calendar overview but not individual detail. Use 7 a.m. set-out deadline, not 6 a.m. calendar range. Existing public-domain streetscape; no upload or implied current collection photo.',
         facts='Who: City of Norwalk. Collection week: Nov. 16-20, 2026. Set-out deadline: 7 a.m. Nov. 16. One pass. Leaves within 6 feet of curb where trash is collected, unbagged, no brush/sticks/yard waste/trash, no parked-car obstruction. Overview and detail both inspected in browser.',
         alternatives=['Norwalk schedules 1 leaf-collection pass for Nov. 16-20', 'Norwalk sets Nov. 16 deadline for loose leaves at the curb'])
]

old = next(a for a in baseline['articles'] if a['slug']=='glcap-utility-assistance-income-guidelines-2026-27')
body = old['body']
body = body.replace('2026–27', '2026-27')
body = body.split('\n\n', 1)[1]
addition = f'''Great Lakes Community Action Partnership's Winter Crisis Program is underway for eligible Ottawa and Sandusky county households facing heating utility shutoffs, disconnected service or low bulk-fuel supplies.

The agency's [Nov. 2 announcement]({winter_url}) says the program runs Nov. 1, 2026, through March 31, 2027. It also covers establishing or transferring service and households with 25% or less of their bulk heating fuel remaining.

Households of up to seven people must have income at or below 175% of the federal poverty guidelines. For households of eight or more, the limit is 60% of state median income, according to the announcement.

'''
update = dict(slug=old['slug'], headline='GLCAP Winter Crisis heating assistance opens for 2026-27 season',
              summary='The program runs through March 31 for eligible households in Ottawa, Sandusky, Seneca and Wood counties facing heating emergencies.',
              change='Update the existing utility-aid guide with the newly announced Winter Crisis season, qualifying emergencies and larger-household income rule; do not queue a duplicate Facebook post.',
              proposed_copy=addition+body,source_url=winter_url)

for s in stories:
    s['status']='ready'
    headlines=[s['headline']]+s.pop('alternatives')
    facts=s.pop('facts')
    draft='# Headlines\n\n'+'\n'.join(f'{i+1}. {h}' for i,h in enumerate(headlines))
    draft+='\n\n# Story\n\n'+s['body']+'\n\n# Notes\n\nStory type: brief / service announcement.\n\nVerified fact inventory: '+facts+'\n\n'+s['notes']+'\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE — Accuracy, attribution, lede, structure, fairness, voice and AP/house style checked against the preserved primary sources. Discrepancies are explicitly described, not resolved by inference.\n'
    (p/'drafts'/f"{s['key']}.md").write_text(draft,encoding='utf-8')

(p/'drafts/winter-update.md').write_text('# Headlines\n\n1. '+update['headline']+'\n2. GLCAP announces winter heating help through March 31\n3. Winter Crisis Program opens in Ottawa, Sandusky counties\n\n# Story\n\n'+update['proposed_copy']+'\n\n# Notes\n\nUpdate to existing guide; preserves verified application information and adds the Nov. 2 release. No error corrected; this is new information. Preserve original publication timestamp and discussion. Income alone does not guarantee approval.\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE — New dates, thresholds and emergencies match the Nov. 2 release; original guide retained with its own source link.\n',encoding='utf-8')

events=[]
for month,day in [('November','18'),('December','16')]:
    date=f'2026-{11 if month=="November" else 12:02d}-{day}'
    events.append(dict(key=f'milan-{month.lower()}',slug=f'milan-village-council-{month.lower()}-{day}-2026',status='ready',title='Milan Village Council holiday meeting',summary='The village reschedules its regular meeting for the holiday season.',description='Public meeting at 6 p.m. The village requests 48-hour notice for agenda placement and citizen-participation remarks, limited to five minutes on the stated topic.',category='meetings',starts_on=date,start_time='18:00',ends_on=None,end_time=None,hours_note='',venue='Village Council Room',address='11 S. Main St.',community='Milan',organizer='Village of Milan',organizer_url='https://www.milanohio.gov/',cost='Not stated',source_url='https://www.milanohio.gov/',image={'status':'none'},notes='Calendar candidate only. Holiday rescheduling notice explicitly gives 2026; no end time stated.'))

packet=dict(date='2026-11-03',scope='Publisher explicitly requested research, newsroom drafts, local import, production sync and Facebook queue. Calendar candidates remain review-only.',compared_against={'articles':len(baseline['articles']),'events':len(baseline['events'])},stories=stories,events=events,updates=[update],featured=['leaves'],held_leads=previous['held_leads']+[dict(topic='Port Clinton pay period and certification reconciliation',source_url=jobs_url,missing='City should clarify pay unit and which certification is required at entry; published brief discloses both source limitations.'),dict(topic='Norwalk Wreaths Across America date',source_url='https://www.norwalkoh.com/city-calendar',missing='Header says Dec. 19, 2026; narrative says Saturday, Dec. 13. Verify with organizer before listing.')],new_sources=[dict(name='Port Clinton employment opportunities',url=jobs_url,logged_in_news_sources=True)])
(p/'research.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

review='''# Nov. 3, 2026 news budget

Compared 114 published stories, 112 local events and 56 library images. Three new service/employment briefs and one update to existing coverage are ready. The publisher requested local-dev import, production sync and Facebook queue in this conversation. This prepublication packet records the reviewed copy; publication outcomes will be recorded separately. Two meeting candidates stay unimported.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Sandusky Transit Yellow Line switches to off-season hours](drafts/yellow.md) | New Nov. 2 notice; schedule effective Nov. 1 | Ready; no cleared bus image |
| 2 | [Port Clinton seeks utility operator; applications due Nov. 16](drafts/operator.md) | New Nov. 2 job listing; business section thin | Ready; no suitable cleared image |
| 3 | [Norwalk leaves must be at the curb by 7 a.m. Nov. 16](drafts/leaves.md) | Set-out deadline and one-pass rule before collection week | Ready; existing public-domain city file photo |

The [transit alert](https://x.com/SanduskyTransit/status/2117270967651066028) was opened individually and dated Nov. 2, 2026. No old summer schedule, other-route changes, fares or seasonal end date inferred. The service-alert image is generic; no unreported schedule details were visible in its description.

The [Port Clinton listing](https://www.portclinton.com/services__/employment__opportunities.php) establishes the Nov. 2 posting and noon Nov. 16 deadline. The full official Facebook announcement and linked PDF were read. Their certification wording differs; the story reports that difference and tells applicants to confirm. Both list a pay range without a pay period; the story explicitly says that. No inference of hourly pay, staffing shortage or a newly created job.

The [Norwalk calendar](https://www.norwalkoh.com/city-calendar) supplies collection instructions; its [detail page](https://www.norwalkoh.com/city-calendar/2020/11/30/leaf-pick-up) confirms the 2026 week despite a 2020 URL. Calendar 6 a.m. range is not the 7 a.m. set-out deadline or an appointment. Distinct from prior brush and large-item coverage.

## Update to existing coverage

[Winter Crisis release](https://www.glcap.org/blog/winter-crisis-program-now-underway-for-2026-2027-season/): update the existing utility-aid story with Nov. 1-March 31 season, emergency criteria and larger-household income limit. This avoids another nearly identical aid story. Original byline, publication date, discussion and Facebook ledger retained; no repost. [Full proposed copy and newsroom check](drafts/winter-update.md).

## Featured and images

Norwalk could be featured using its existing public-domain streetscape. This run preserves feature selections because the request authorizes publication and queuing but does not request replacing them. Reuse media 733286ca-e923-4c65-9952-8cac1a5ce602 with existing caption, credit and alt text. [OHWiki source and public-domain record](https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG). Photograph uploaded July 18, 2008, explicitly a file photo, not current pickup. Verify local/production metadata and bytes before reuse. No new image uploads. Other stories use masthead previews.

## Potential calendar additions

| Event | Date and time | Place | Access and remaining checks |
| --- | --- | --- | --- |
| Milan Village Council | Nov. 18, 6 p.m. | Council Room, 11 S. Main St. | Public; village requests 48-hour notice to speak; end time unstated |
| Milan Village Council | Dec. 16, 6 p.m. | Council Room, 11 S. Main St. | Same holiday rescheduling notice |

Both come from the [village's year-specific notice](https://www.milanohio.gov/). Neither occurs today. Earlier Dark Skies webinar is tomorrow, Nov. 4, in yesterday's packet; no duplicate candidate or import. These calendar items are not being expanded into stories.

## Useful new sources

[Port Clinton employment opportunities](https://www.portclinton.com/services__/employment__opportunities.php) supplies dated postings, deadlines, downloadable descriptions and application routes. Added as guidance within the existing city source entry, not as a duplicate organization. Read PDF and social announcement together: certification wording differs and pay units are absent.

## Held leads and source checks

Earlier held leads carried forward in research.json; no unverified update to the Perkins demolition appeal or CACEHR winter-season conflict. GLCAP now supplies its own season directly; that does not resolve another provider's page. Camp Street, office closure, health recruitment, choir grant and career programs were already covered. Sandusky, Huron, schools, parks, Sea Grant, growth partnership, GLCAP, Norwalk, Monroeville, Vermilion schools, BGSU Firelands, Ottawa refuge, Huron health and Castalia pages preserved. Blocked fetches recorded honestly; no claim of an exhaustive sweep of every source.

Signed-in Facebook: Sandusky closure duplicates yesterday; Perkins Township election reminder supplies no new story; older PerkinsLSD Page top post is June baseball, not current news. Port Clinton supplied current job and Veterans Day lunch leads. Lunch requires full organizer/flyer verification before listing. Facebook event search returned no results. Signed-in X supplied the Yellow Line alert. Google News returned election guides, obituaries, a Route 250 feature and a Cedar Point seasonal-closure headline; none reused as primary reporting. Norwalk Wreaths Across America header and narrative disagree on December date; hold for organizer confirmation. No resident comments used.

## Evidence and validation

Primary HTML/text, timestamps and hashes retained in evidence. The city job PDF was extracted using the bundled pypdf and rendered with bundled Poppler; page one visually verified. Browser-only source facts retained as dated transcriptions. Newsroom Write and Check passes completed for all new briefs and the guide update, with no unresolved copy flags. Source limitations explicitly disclosed in published copy. Import and sync utilities retain exact copy hashes, before snapshots, SQL and write-intent journals. No commits, pushes, release or code deployment requested.
'''
(p/'review.md').write_text(review,encoding='utf-8')
(p/'evidence/browser-sources.md').write_text(f'''# Browser source checks — Nov. 3, 2026

## Sandusky Transit
{transit_url}
Individual post timestamp: 10:01 AM, Nov. 2, 2026. Text: As of Nov. 1 the Yellow Line is running its off-season schedule, Monday-Saturday, 6:30 a.m.-8:30 p.m. Image description: generic blue service alert featuring a bus and STS logo. Official account linked to sanduskytransit.com. Read only; no media downloaded.

## Port Clinton
{job_post}
Full public post read in modal. Full-time Utility Department job; Monday-Friday 7 a.m.-3 p.m., some overtime; pay range $30.44-$36.32 depending on experience, no unit. Ohio EPA Water Distribution I or Wastewater Collection I or greater; valid driver's license, CDL within 12 months. Application in person/mail City Hall, Attn Sandye Chafee, 1868 E. Perry Street, Port Clinton, Ohio 43452, or pcadmin@portclinton-oh.gov. Noon Monday Nov. 16, 2026 deadline. Dated website listing supplies Nov. 2 posting. PDF page one differs on certification; conflict disclosed. No images taken from social.

## Norwalk
https://www.norwalkoh.com/city-calendar
Year-specific leaf block: Nov. 16-20, 2026. Text requires leaves on curb by 7 a.m. Nov. 16, within 6 feet where trash is collected, no bags/mixed debris/parked-car obstruction, one pass only. Individual detail contains year and dates but omits narrative.

## Other social checks
https://www.facebook.com/cityofsandusky — newest visible post repeats Nov. 3 office closure already covered.
https://www.facebook.com/PerkinsTownship — Nov. 3 election reminder and county polling-place link; no separate new story.
https://www.facebook.com/PerkinsLSD — top visible post is June 2026 baseball championship, not new.
https://www.facebook.com/search/events/?q=Sandusky%20Ohio — no results.
https://news.google.com/search?q=Sandusky%20Ohio%20when%3A3d&hl=en-US&gl=US&ceid=US%3Aen — secondary leads only; not evidence for story facts.
''',encoding='utf-8')
print('Prepared three stories, one guide update and two review-only meeting candidates.')
