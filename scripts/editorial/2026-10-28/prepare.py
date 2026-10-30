"""Save the verified October 28 budget and Newsroom Write/Check output."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

directory = editorial_directory('2026-10-28')
assert not (directory / 'local-import.json').exists(), 'Packet already imported'
baseline = json.loads((directory / 'evidence/existing-content.json').read_text(encoding='utf-8'))
stories = [
    dict(key='grants', slug='sandusky-jobsohio-small-business-grants-october-2026', section='business', community='Erie County',
         headline='Sandusky partnership points businesses to grants of up to $50,000',
         summary='The JobsOhio program supports eligible investments. The partnership cites grants to Wallace Stud Welding and Firelands Food Systems.',
         body='''Businesses planning equipment purchases or expansions can seek JobsOhio grants of up to $50,000, Greater Sandusky Partnership says in a new funding notice.

The partnership's [Oct. 26 announcement](https://greatersandusky.com/state-offers-grants-of-up-to-50000/) cites two local recipients: Wallace Stud Welding in Berlin Heights, in Erie County, and Sandusky-based Firelands Food Systems.

Wallace received $25,000 toward a second welding unit, the partnership says. Firelands Food Systems received $50,000 toward expansion into an adjacent building. The partnership describes 10 new jobs as an expected result of the latter project; it does not establish that those positions have been filled.

[JobsOhio's program page](https://www.jobsohio.com/incentives-programs/support-for-small-businesses/jobsohio-small-business-grant) says applicants need at least one year of operations, annual revenue between $100,000 and $25 million and a business in a target industry with revenue primarily from sales to other businesses. Applicants must plan an eligible investment and demonstrate why the grant is needed to move it forward.

Typical eligible expenses include facility acquisition or improvements, machinery, industry-specific software and training. Additional requirements and project approval apply.

Businesses can contact Braden Michel, the partnership's project development manager, at bmichel@greatersandusky.com to discuss eligibility and next steps.''',
         source_urls=['https://greatersandusky.com/state-offers-grants-of-up-to-50000/', 'https://www.jobsohio.com/incentives-programs/support-for-small-businesses/jobsohio-small-business-grant'],
         image={'status':'none'},
         notes='Current Oct. 26 funding outreach, not a newly created program or a claim the awards were made Oct. 26. No application deadline or award date supplied. Program landing page gives an inclusive revenue range; linked older guidelines use less than $25 million for company and parent. Readers at that boundary must confirm eligibility. No guarantee of funding. Grant and projected-job claims attributed to GSP.'),
    dict(key='volunteers', slug='sandusky-five-volunteer-year-honorees-october-2026', section='community', community='Sandusky',
         headline='Sandusky recognizes 5 volunteers for community service',
         summary='Mark Fogg, Anne McGookey, Jeff and Diane Corso and John Schlessman received the city’s Volunteer of the Year awards Monday.',
         body='''Five Sandusky volunteers received the city's Volunteer of the Year awards Monday for work ranging from youth sports and literacy to community events and park upkeep.

The City Commission recognized Mark Fogg, Anne McGookey, Jeff and Diane Corso and John Schlessman at its Oct. 26 meeting, according to the [city's announcement](https://www.cityofsandusky.com/news_detail_T12_R196.php), posted Tuesday.

Fogg's service includes youth coaching, the Sandusky Lions Club and church and school activities, the city says. McGookey coordinates Dolly Parton's Imagination Library of Erie County and has volunteered with service and charitable organizations.

Jeff and Diane Corso have helped with the Sandusky Christmas Market and the Facer Park Adoption Project. Their service also includes school, civic and community activities, according to the city.

Schlessman and his wife, Lori, co-founded Al's Clinics in memory of their son, Alan. The city says the volunteer organization has supported Sandusky-area young people with lessons, camp fees, athletic equipment and scholarships since 2003.

Commissioner Dave Waddington established the awards in 2021. The commission chooses recipients from nominations submitted by residents and community organizations.''',
         source_urls=['https://www.cityofsandusky.com/news_detail_T12_R196.php'],
         image={'status':'permission-needed', 'contact':'communications@cityofsandusky.com'},
         notes='Recognition occurred Monday Oct. 26; homepage dates announcement Oct. 27. Five individuals, with the Corsos grouped in the release. Official Facebook corroborates all five names; no photograph reused without permission. Brief/press-release rewrite; all service claims attributed.'),
    dict(key='board', slug='glcap-board-nominations-ottawa-sandusky-november-2026', section='government', community='Ottawa and Sandusky counties',
         headline='GLCAP board nominations to open Monday in Ottawa, Sandusky counties',
         summary='Residents can nominate themselves Nov. 2-4 for seats representing low-income residents. Candidates do not have to be low-income themselves.',
         body='''Residents of Ottawa and Sandusky counties can nominate themselves for seats representing low-income residents on Great Lakes Community Action Partnership's board starting Monday.

The Fremont-based agency's [board election notice](https://www.glcap.org/) says nominations for the 2027-28 terms will be accepted from 8:30 a.m. Monday through 4:30 p.m. Wednesday, Nov. 4. One seat is available in each county, along with seats for Seneca and Wood counties.

Candidates must live in the county they seek to represent, but they do not have to be low-income themselves. Their role is to advocate for that county's low-income residents, the agency says.

Eligible nominees will appear on an online ballot available from 8:30 a.m. Nov. 9 through 4:30 p.m. Nov. 11. The agency says it will notify nominees after votes are counted, with ties decided by a coin toss.

Employees and their immediate family members cannot run or vote in the election. Incomplete or inaccurate nominations may be disqualified.

County nomination links are on the agency's homepage. The Ottawa County form was not accepting responses when checked Wednesday, ahead of the announced opening. Questions can go to 1-800-775-9767.''',
         source_urls=['https://www.glcap.org/'], image={'status':'none'},
         notes='Notice explicitly gives 2027-28 terms; 2026 weekday/date alignment confirms Nov. 2-4. No posting date asserted. Ottawa form checked read-only and closed ahead of opening; do not describe applications as open today. No form submitted, no voter eligibility beyond the stated employee exclusion inferred.'),
]
alternatives = {
    'grants':['JobsOhio funding notice highlights 2 Erie County businesses','Small businesses can ask Sandusky partnership about expansion grants'],
    'volunteers':['City honors 5 Sandusky residents with volunteer awards','Sandusky volunteer awards recognize coaching, literacy and civic work'],
    'board':['GLCAP seeks county representatives for 2027-28 board terms','Ottawa, Sandusky residents can seek GLCAP board seats Nov. 2-4'],
}
for s in stories:
    s['status']='ready'
    assert len(s['summary']) <= 160
    assert s['slug'] not in {a['slug'] for a in baseline['articles']}
    output='# Headlines\n\n'+ '\n'.join('- '+h for h in [s['headline'],*alternatives[s['key']]])
    output+='\n\n# Story\n\n'+s['body']+'\n\n# Notes\n\n'+s['notes']
    output+='\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE\n'
    (directory/'drafts'/f"{s['key']}.md").write_text(output,encoding='utf-8')

held=[
 {'topic':'Perkins Doerzbach demolition appeal outcome','source_url':'https://perkinstownship.com/board-of-trustees/','missing':'No signed action or primary outcome verified; direct meeting-page request returned 403. No outcome inferred from elapsed hearing date.'},
 {'topic':'Camp Street paving completion','source_url':'https://cityofsandusky.com/city_projects/camp_street.php','missing':'Oct. 14 schedule and Oct. 17 X post still list Oct. 26-27 work, subject to weather. Neither confirms completion or reopening.'},
 {'topic':'Community Christmas assistance','source_url':'https://www.glcap.org/sandusky-county-community-christmas/','missing':'Carry-forward: yesterday’s notification dates conflict. Not newly resolved or imported today.'},
 {'topic':'Invasive species buyback','source_url':'https://eriemetroparks.org/buyback/','missing':'Fresh page gives Nov. 30 but no year. Verify 2026 participation and stock before publishing a current deadline.'},
 {'topic':'ABC Supply acquires Koch Building Products','source_url':'https://www.abcsupply.com/news-events/abc-supply-co-inc-acquires-the-assets-of-koch-building-products/','missing':'Rejected as new news: Google News surfaces it this week but company release is dated June 22, 2026.'},
 {'topic':'Winter Crisis assistance','source_url':'https://www.cacehr.org/winter-crisis-program','missing':'Carry-forward: current local season and appointment terms remain unverified; no new provider confirmation today.'},
 {'topic':'Health department mental-health awareness post','source_url':'https://www.facebook.com/ErieCoHealthOhio','missing':'Fresh top-feed Your Mind Matters post is an awareness lead; no new verified service change or event established.'},
 {'topic':'BGSU Firelands and Huron County health','source_url':'https://www.bgsu.edu/firelands/news.html','missing':'Promising source sweep: no distinct fresh publishable item verified; no assumption an old list means no news.'},
]
packet=dict(date='2026-10-28',scope='Verified budget followed by editor-authorized local import, production sync and Facebook queuing; no feature changes',compared_against={'articles':len(baseline['articles']),'events':len(baseline['events'])}, stories=stories,events=[],updates=[],featured=[],held_leads=held,new_sources=[{'name':'JobsOhio Small Business Grant','url':'https://www.jobsohio.com/incentives-programs/support-for-small-businesses/jobsohio-small-business-grant','logged_in_news_sources':True}])
(directory/'research.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(directory/'review.md').write_text('''# Oct. 28, 2026 news budget

Compared 100 stories, 112 events and 56 library images with yesterday's review and publication record. Three ready stories, no calendar additions and no verified updates to existing coverage. The editor has already authorized local dev review, production sync and Facebook queuing in this conversation. At packet preparation, no content writes have occurred. Publication results will be recorded separately.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Sandusky partnership points businesses to grants of up to $50,000](drafts/grants.md) | Oct. 26 outreach; business thin this week | Ready; no cleared subject image |
| 2 | [Sandusky recognizes 5 volunteers for community service](drafts/volunteers.md) | Monday recognition, Tuesday city release | Ready; city award photo needs permission |
| 3 | [GLCAP board nominations to open Monday in Ottawa, Sandusky counties](drafts/board.md) | Nov. 2-4 nomination window approaching | Ready; no cleared subject image |

The [partnership grant announcement](https://greatersandusky.com/state-offers-grants-of-up-to-50000/) is a current outreach notice, not a new program launch. Award dates are unstated. The [JobsOhio page](https://www.jobsohio.com/incentives-programs/support-for-small-businesses/jobsohio-small-business-grant) corroborates investment uses and basic eligibility. Its landing-page revenue range includes $25 million while its linked older guidelines say less than $25 million for company and parent. The brief summarizes the current page and directs applicants to confirm eligibility; it makes no determination for a particular company. Projected positions are not jobs filled. No grant amount or deadline invented.

The [city release](https://www.cityofsandusky.com/news_detail_T12_R196.php) lists the Corsos together, but there are five individual honorees. Recognition was Oct. 26; homepage posting date is Oct. 27. The expanded official Facebook post corroborates the names. All biographical service claims remain attributed. No unsupported award ranking or invented response.

The [GLCAP notice](https://www.glcap.org/) identifies 2027-28 terms and Nov. 2-4 nominations. The Ottawa form currently says it is not accepting responses, consistent with the future opening; the draft tells readers this rather than presenting an open form today. Candidates need not be low-income. No invented age, compensation, meeting schedule or guarantee of election.

Each draft includes three headlines, Newsroom Write output and a separate Check pass. No unresolved flags in the limited published scope. Byline on import: JD, linked to the existing author account.

## Images and featured stories

All 56 library images were searched. No image directly depicts the recipients, businesses or board election. No source or social photo reused. Use the site's standard masthead preview. No new featured selection recommended.

Draft permission request, not sent: to communications@cityofsandusky.com: “May Firelands Current use the city’s photograph of the Oct. 26 Volunteer of the Year presentation on our website and in social promotion? Please confirm the photographer, capture date, required credit and permission.”

## Calendar and existing coverage

No new verified calendar additions; today's Magee Marsh walk, jail tours and Spilling the Tea program are already listed. Facebook event search returned no results. Existing Halloween, leaf collection, Head Start, pharmacy and grant coverage was excluded as duplicate. Do not manufacture an event from the nomination deadline.

No confirmed Camp Street completion or Perkins appeal decision. The saved project page and city X still establish only the scheduled work. Yesterday's Christmas assistance and Winter Crisis gaps remain held, with no claim they were resolved today.

## Useful new sources

[JobsOhio's grant program](https://www.jobsohio.com/incentives-programs/support-for-small-businesses/jobsohio-small-business-grant) was added to docs/news-sources.md: primary program eligibility, investment uses and regional contacts; compare the current landing page with linked guidelines before quoting precise boundaries. ABC Supply is a useful company source, but its acquisition notice proved to be June news and was rejected.

## Held leads and source checks

See research.json for eight held/rejected leads. Read-only targeted sweep included Sandusky, Huron, Perkins, Sandusky schools, Erie health, GSP, Huron County Growth Partnership, Ohio Sea Grant, Erie MetroParks, Monroeville, GLCAP, Oak Harbor, BGSU Firelands and Huron County health. Schools' Gold rating, Huron promotions and Sea Grant wetland/sensory stories already exist. New GLCAP Newport item is outside the immediate coverage focus and was not selected.

Signed-in browser checks covered city Facebook, Erie health Facebook, city X, Facebook event search and Google News. City Facebook yielded volunteer corroboration. X supplies no verified Camp Street completion. Google News's apparently fresh Koch acquisition resolves to the company's June 22 release. This is a targeted sweep, not every account in the source directory. No comments, reactions, follows, messages or form submissions.

## Evidence and validation

Primary-page HTML, extracted text, access times and SHA-256 checksums are saved in evidence/sources.json and additional-sources.json. GSP direct request was 403 but the browser read the full dated announcement; browser transcription is saved separately. Initial sandbox DNS failures were overcome with authorized source retrieval. Access failures are not evidence of no news. Packet validation and repository checks will be saved in evidence/. No migrations, feature changes, code deployment, commit, push or version bump are required.
''',encoding='utf-8')
print('Prepared',len(stories),'ready stories')
