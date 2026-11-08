import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory
p=editorial_directory('2026-10-31')
stories=[dict(key='nurses',slug='erie-county-detox-nurse-recruitment-october-2026',section='business',community='Sandusky',headline='Erie County Detox seeks registered and practical nurses',summary='The health department is recruiting nurses for its detox program and directs applicants to its job listings.',body='''Erie County Detox is recruiting registered nurses and licensed practical nurses, according to a new Erie County Health Department announcement.

The department's [official Facebook announcement](https://www.facebook.com/photo/?fbid=1160222070274196&set=a.102396149390132) directs applicants to its jobs website. The accompanying recruitment flyer identifies the detox program and both nursing credentials.

The department's [current job openings page](https://eriehealthohio.com/jobs/job-openings/) lists a full- or part-time behavioral health position for a licensed practical nurse or registered nurse. It also links to a job application and the position description.

The social announcement gives no application deadline or pay rate. Applicants should review the position description for qualifications, duties and employment terms before applying.''',source_urls=['https://www.facebook.com/photo/?fbid=1160222070274196&set=a.102396149390132','https://eriehealthohio.com/jobs/job-openings/'],notes='Fresh official social recruitment checked Oct. 31; website corroborates current nurse opening. Do not call this a newly created position or infer a vacancy count, expansion or staffing shortage. No promotional pay or benefit claim repeated.'),
dict(key='christmas',slug='sandusky-county-community-christmas-deadline-november-16-2026',section='community',community='Sandusky County',headline='Sandusky County Christmas assistance applications due Nov. 16',summary='The online program connects eligible households with holiday donors. Assistance is not guaranteed, and notification dates conflict.',body='''Sandusky County households seeking holiday gifts and food assistance have until 9 a.m. Nov. 16 to apply for Community Christmas, according to Great Lakes Community Action Partnership.

The [program page](https://www.glcap.org/sandusky-county-community-christmas/) links to the 2026 electronic application. Only one application is allowed per address, including when two families share a home.

The form requires county residency and at least one school-age child or younger child, or a household member older than 65. Applicants must provide the last four digits of Social Security numbers for everyone listed, a working phone number and an electronic signature.

Children 12 and younger can submit gift wishes and clothing sizes. Ages 13-18 may be included for gifts if enrolled in high school. Requests are not guaranteed to be filled.

Notification information conflicts: the program page says Dec. 1, 2026, while the 2026 form retains a Dec. 10, 2025, sentence. Confirm notification timing with the organizer. The application deadline agrees on both pages.

For help applying, notification questions or sponsorship information, call or text 567-342-1639 or email communitychristmas.sc@gmail.com.''',source_urls=['https://www.glcap.org/sandusky-county-community-christmas/'],notes='Live 2026 form opened through the narrative forms.gle link, without entering or submitting data. Top Apply button points to closedform while narrative link opens viewform; story directs to page and records working path in review. Notification conflict disclosed, not guessed. Deadline and eligibility agree. Seasonal deadline is the peg, not a claim that applications just opened.'),
dict(key='utility',slug='glcap-utility-assistance-income-guidelines-2026-27',section='local',community='Ottawa and Sandusky counties',headline='GLCAP lists 2026–27 utility-aid income limits and application requirements',summary='Ottawa and Sandusky county residents can check eligibility and arrange appointments for help with utility bills or low fuel supplies.',body='''Ottawa and Sandusky county residents facing utility shutoffs or low heating-fuel supplies can check 2026–27 income limits and arrange assistance appointments through Great Lakes Community Action Partnership.

The agency's [utility bill assistance page](https://www.glcap.org/programs/utility-payment-assistance/utility-bill-assistance/) lists annual income limits of $27,930 for one person, $37,870 for two and $57,750 for four. Households must meet the program's other eligibility requirements; income alone does not establish approval.

The service covers Ottawa, Sandusky, Seneca and Wood counties. Applicants need household members' Social Security numbers and birth dates, proof of citizenship, income documentation for adult household members and recent utility bills. Disability verification is required when applicable.

The page links to online appointment scheduling. Residents can also call 419-463-2242. Listed local appointment sites include the agency's headquarters at 127 S. Front St. in Fremont and its family development center at 1848 E. Perry St. in Port Clinton.

The agency says it no longer has water-utility assistance funding. For information about available help and required documents, call 800-775-9767.''',source_urls=['https://www.glcap.org/programs/utility-payment-assistance/utility-bill-assistance/'],notes='Seasonal service brief using explicitly labeled 2026-2027 provider guidelines. No claim of a new benefit, increased limits or Nov. 1 application opening. Distinct from yesterday’s WarmChoice insulation story; no benefit amounts, guaranteed disconnection hold or financial advice. Does not extend this provider’s bill-aid counties to Erie/Huron.' )]
camp='''*Updated Oct. 31: The city has confirmed resurfacing; striping and finishing work remain.*

Camp Street has been resurfaced between Monroe and Frantz streets, but drivers should watch for an unstriped roadway while finishing work continues, the City of Sandusky says.

The city's [Friday update](https://www.facebook.com/cityofsandusky/posts/pfbid02zZeh6erKWaVLxkGCMewcDJC4j3ygiGeTmkzPz5eW92U3tdphtxXagLZDULwCXr9Fl) says contractor Erie Blacktop resurfaced the section this week. Striping and other finishing work are expected over the coming weeks; the notice gives no specific completion date.

The city asks motorists to be especially attentive because the roadway currently has no striping.

The work also included roadway and sidewalk repairs and new sidewalk curb ramps. The city says the paving completes resurfacing along Camp Street from Washington Street to Perkins Avenue, done in sections over several years.

The [project page](https://cityofsandusky.com/city_projects/camp_street.php) lists a $505,808.90 contract, split equally between an Ohio Public Works Commission grant and the city's Capital Projects Fund. Its older Oct. 14 construction update scheduled paving for Oct. 26-27, subject to weather and field conditions.

Questions can go to project coordinator Melissa Vassallo at 419-627-5932.'''
updates=[dict(slug='sandusky-camp-street-milling-paving-october-19-2026',headline='Camp Street resurfaced; city warns drivers striping is still to come',summary='Paving between Monroe and Frantz streets is done, the city says. Striping and other finishing work will continue over the coming weeks.',change='Replace schedule-led copy with confirmed resurfacing and unstriped-road warning. Preserve URL, original publication date and discussion; dated update, not correction.',proposed_copy=camp,source_url='https://www.facebook.com/cityofsandusky/posts/pfbid02zZeh6erKWaVLxkGCMewcDJC4j3ygiGeTmkzPz5eW92U3tdphtxXagLZDULwCXr9Fl')]
alternatives={'nurses':['Health department recruits nurses for Erie County Detox','Erie County posts behavioral health nursing opening'],'christmas':['Community Christmas sets Nov. 16 application cutoff','Holiday assistance applications open for Sandusky County households'],'utility':['Ottawa, Sandusky residents can check utility-aid eligibility','GLCAP provides appointment contacts for utility assistance'],'camp':['Camp Street paving done between Monroe and Frantz','Sandusky schedules finishing work after Camp Street resurfacing']}
for s in stories:
 s.update(status='ready',image={'status':'none','notes':'No cleared subject photo; masthead social preview. Library images reviewed, no suitable image chosen.'})
for s in stories+[dict(key='camp',headline=updates[0]['headline'],body=camp,notes=updates[0]['change'])]:
 facts={'nurses':'Who: Erie County Health Department. What: RN/LPN detox recruitment; current behavioral health listing full or part time. When: social page checked Oct. 31, post displays 18 hours ago. How: official job page/application. No quotes.','christmas':'Who: county Community Christmas, GLCAP host. What: holiday assistance. When: 2026 form, Nov. 16 at 9 a.m. deadline. Where: Sandusky County, not city of Sandusky alone. Eligibility and required documents read in live form. Why: deadline approaching. No quotes.','utility':'Who: GLCAP. What: utility bills/fuel aid and 2026-27 guidelines. Where: Ottawa, Sandusky, Seneca, Wood counties. How: listed documents and scheduling contacts. When: current 2026-27 season; no new launch date inferred. No quotes.','camp':'Who: city and Erie Blacktop. What: resurfacing confirmed, striping pending. When: Friday update, checked Oct. 31. Where: Monroe-Frantz; broader corridor Washington-Perkins. How: project and city notice. No quotes.'}[s['key']]
 (p/'drafts'/f"{s['key']}.md").write_text('# Headlines\n\n'+'\n'.join('- '+h for h in [s['headline']]+alternatives[s['key']])+'\n\n# Story\n\n'+s['body']+'\n\n# Notes\n\n'+facts+'\n\n'+s['notes']+'\n\n# Flags\n\nNONE\n\n# Newsroom Check mode\n\nNONE\n',encoding='utf-8')
previous=json.loads((editorial_directory('2026-10-30')/'research.json').read_text(encoding='utf-8'))
held=[h for h in previous['held_leads'] if h['topic'] not in ['Camp Street paving completion','Community Christmas assistance','Ohio job metrics']]
held += [dict(topic='Sandusky job growth headline',source_url='https://greatersandusky.com/',missing='Homepage dates underlying release Aug. 12, 2026. Rejected as fresh news.'),dict(topic='KFC closure',source_url='https://news.google.com/',missing='New secondary headline; no company or franchise confirmation verified. No closure story published.'),dict(topic='Education foundation fundraiser',source_url='https://www.scs-k12.net/LocalGrantOpportunities.aspx',missing='Secondary $18,000 claim needs dated foundation/district confirmation; grants page alone does not establish event receipts.'),dict(topic='Huron Memory Cafe',source_url='https://huronlibrary.libcal.com/event/16732486',missing='Nov. 5 10:30-11:30 a.m. listing identifies Rooms A/B but registration boilerplate calls it online. Confirm delivery format before calendar entry.')]
packet=dict(date='2026-10-31',scope='Verified budget and newsroom drafts; publisher explicitly authorized local import, production sync and Facebook queue. Results recorded separately.',compared_against={'articles':108,'events':112},stories=stories,events=[],updates=updates,featured=[],held_leads=held,new_sources=[dict(name='Erie County Health Department job board',url='https://eriehealthohio.com/jobs/job-openings/',logged_in_news_sources=True)])
(p/'research.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(p/'review.md').write_text('''# Oct. 31, 2026 news budget

Compared 108 published stories, 112 events and 56 library images. Three new briefs and one urgent update. Publisher authorized local dev import, production sync and Facebook queue in this chat. This packet was prepared before import; final outcomes belong in production-publication.md.

## First action: Camp Street driver warning

[City update](https://www.facebook.com/cityofsandusky/posts/pfbid02zZeh6erKWaVLxkGCMewcDJC4j3ygiGeTmkzPz5eW92U3tdphtxXagLZDULwCXr9Fl) confirms resurfacing between Monroe and Frantz, but striping and finishing remain. Replace schedule-led existing story with [checked update](drafts/camp.md), preserve URL and discussion, add dated update. Do not describe all project work as finished. Do not requeue the previously delivered story.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Erie County Detox seeks registered and practical nurses](drafts/nurses.md) | New official recruitment; business section thin | Ready; no cleared photo |
| 2 | [Sandusky County Christmas assistance applications due Nov. 16](drafts/christmas.md) | Verified 2026 deadline; practical application access | Ready; no cleared photo |
| 3 | [GLCAP lists 2026–27 utility-aid income limits and application requirements](drafts/utility.md) | Heating-season service access and current-year requirements | Ready; no cleared photo |

Nurse announcement read in signed-in official Facebook Page and flyer viewed; [current jobs](https://eriehealthohio.com/jobs/job-openings/) corroborates RN/LPN behavioral health position. No job-creation count, pay-rate claim or staffing-shortage inference.

[Christmas program page](https://www.glcap.org/sandusky-county-community-christmas/) and live 2026 form agree on Nov. 16, 9 a.m. The narrative forms.gle link opens the application; the top button points to closedform. The form still says Dec. 10, 2025 notification while page says Dec. 1, 2026. Disclose conflict and give organizer contact; no promise of aid. No data entered or submitted.

[Utility provider page](https://www.glcap.org/programs/utility-payment-assistance/utility-bill-assistance/) explicitly labels 2026-2027 guidelines and lists local appointment sites. Seasonal brief, not a new program announcement or a duplicate of yesterday's home-insulation report. Provider serves Ottawa/Sandusky, not Erie/Huron for this bill-aid service. No unverified Winter Crisis opening or end date used.

Every draft contains three headline options, a fact inventory, Write output and a Check result with no unresolved flags.

## Images and featured stories

Baseline library inspected. No cleared recruitment, holiday-assistance or utility-aid subject photograph identified; no social or website images reused. Use standard masthead previews. No feature change recommended.

## Calendar

No new ready event; today's Halloween listings are already present. Huron Memory Cafe held for conflicting in-person/online wording. Norwalk holiday and large-item listings duplicate existing coverage.

## Useful new sources

| Source | Leads supplied | How to use it |
| --- | --- | --- |
| [Erie County Health Department job board](https://eriehealthohio.com/jobs/job-openings/) | Current position descriptions and official application | Pair social recruitment with current listing; posting number and PDF date do not establish newly created jobs |

Logged job board and application-link traps in docs/news-sources.md. Scouted school grants/foundation support, BGSU Firelands and Oak Harbor; no stale item used to fill the schools section.

## Held leads and source checks

Carried forward unresolved Perkins appeal, invasive buyback year, local CACEHR winter-season conflict, and other prior holds. Job-growth release dated August, not fresh news. KFC closure and foundation fundraiser remain secondary leads requiring primary verification. No allegations reused.

Targeted primary sweep preserved in evidence: Sandusky, schools, GLCAP, Sea Grant, Perkins (403), Camp Street, Erie MetroParks, Huron County partnership, Oberlin (403), Monroeville, health, Firelands Health (403), Huron library, BGSU, CACEHR, Norwalk, Hayes (403), Oak Harbor. Access failures do not establish no news. No claim to have checked every directory source.

Signed-in social read: Sandusky Facebook supplied new Camp Street notice; health Facebook supplied new nurse recruitment. X still leads with Oct. 26 commission notice and older paving schedule. Facebook event search returned no results. Google News showed KFC closure, older acquisition and traffic leads; none used without primary evidence. No social actions, messages or submissions.

## Evidence and validation

Source HTML/text and request timestamps/hashes retained in evidence. Browser-only announcement and application excerpts preserved separately. No permission request sent. Production utility retains SQL, before snapshots, write journals and live checks. No commit, push, release or code deployment is needed for this content work.
''',encoding='utf-8')
print('Prepared 3 stories and 1 update')
