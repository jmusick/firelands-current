"""Prepare the verified November 12 budget without database writes."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

directory = editorial_directory('2026-11-12')
assert not (directory / 'local-import.json').exists()
school = 'https://www.scs-k12.net/protected/ArticleView.aspx?iid=6IIYII0&dasi=3GGI'
trail = 'https://ottawacountyparksoh.org/wp-content/uploads/2026/11/LPA-ConsInspConsAdmin-Programmatic-Announcement-Genoa-Phase-One-Veterans-Park-to-9th-St-1.pdf'
genoa = 'https://genoaohio.org/village-departments/veterans-park-quarry/'
jobs = 'https://www.eriecounty.oh.gov/content.aspx?id=26854'
job = 'https://www.eriecounty.oh.gov/Downloads/2026-059%20-%20FT%20Social%20Services%20Worker%20I%20-%20JFS%20ADA.pdf'
apply = 'https://www.eriecounty.oh.gov/protected/OnlineJobApplication.aspx'
webinar = 'https://ohioseagrant.osu.edu/news/calendar/2026/11/18/desk6/freshwater-science'

stories = [
    dict(key='rudolph', slug='sandusky-schools-joseph-rudolph-transportation-supervisor-november-2026',
         section='schools', community='Sandusky',
         headline='Sandusky schools name Joseph Rudolph transportation supervisor',
         summary='The district announced the appointment Wednesday. Rudolph has driven school buses since 2017, according to its release.',
         body=f'''Joseph Rudolph has been appointed transportation supervisor for Sandusky City Schools, the district announced Wednesday.

Rudolph has worked as a school bus driver since 2017 and has more than 30 years of experience in sales, management and operations, according to the district's [Nov. 11 news release]({school}).

The appointment places him in a leadership role in the department responsible for transporting the district's students. The release does not give his start date or salary.

For more information, the district lists 419-984-1000.''',
         source_urls=[school],
         notes='Brief. Facts: Joseph Rudolph; transportation supervisor; announcement Nov. 11, 2026; bus driver since 2017; more than 30 years in sales, management and operations. No claim about previous employers, predecessor, route changes, salary or effective date. No quotes. Primary release preserved as HTML and text. No cleared portrait.'),
    dict(key='genoa', slug='genoa-north-coast-inland-trail-consultant-deadline-november-24-2026',
         section='outdoors', community='Genoa',
         headline='Ottawa County park district seeks consultant for Genoa trail extension',
         summary='Responses are due Nov. 24 for inspection and administration of a planned 2,400-foot trail section and Packer Creek bridge.',
         body=f'''The Park District of Ottawa County is seeking a consultant to oversee construction of a planned North Coast Inland Trail extension in Genoa, with responses due Nov. 24.

The project would add about 2,400 feet of paved, off-road trail from Veterans Memorial Park to West Ninth Street, including a pedestrian bridge across Packer Creek, according to the district's [request for qualifications (PDF, 13 pages)]({trail}). The document estimates construction at about $1.27 million.

The existing trail connects Genoa with Elmore, Lindsey and Fremont, according to the village's [Veterans Memorial Park page]({genoa}). The proposed work is the Genoa project's first phase.

The Oct. 30 notice seeks construction inspection and administration services. It anticipates a December notice to proceed, with substantial completion 150 calendar days later and final completion another 30 days after that. Those are planned milestones, not a confirmed opening date.

Interested firms must meet the notice's Ohio Department of Transportation prequalification requirements. Letters of interest are due by 4:30 p.m. Nov. 24, either as one electronic copy to jwilson@ottawacountyparksoh.org or four paper copies to Jannah Wilson, Park District of Ottawa County, 770 SE Catawba Road, Port Clinton, Ohio 43452. Late responses will not be considered.''',
         source_urls=[trail,genoa,'https://ottawacountyparksoh.org/'],
         notes='Procurement brief. RFQ posted Oct. 30, 2026; current response deadline Nov. 24, 4:30 p.m. Scope is consultant inspection/administration, not a construction award or finished trail. $1,266,917.50 is estimated construction cost, rounded to $1.27 million; do not equate it with consultant fee or older STIP estimate. December authorization anticipated; no exact opening date inferred. Pages 1-4 visually checked, full 13-page text saved. Genoa village page confirms existing regional connections. No cleared project image.'),
    dict(key='social-worker', slug='erie-county-social-services-worker-applications-december-9-2026',
         section='business', community='Erie County',
         headline='Erie County seeks social services worker at $20.54 an hour',
         summary='Applications are due Dec. 9 for the full-time Job and Family Services position. Pay rises to $21.36 an hour after probation.',
         body=f'''Erie County Job and Family Services is accepting applications through Dec. 9 for a full-time social services worker position paying $20.54 an hour during probation and $21.36 afterward.

The county's [Nov. 9 posting (PDF, 3 pages)]({job}) sets a 4:30 p.m. closing deadline. Duties include supervising visits between children and families, transporting clients and supporting social services staff.

Applicants need a high school diploma or equivalent, a valid Ohio driver's license and an operable vehicle. Education beyond high school is desired, and Erie County residency is preferred. A pre-employment physical and drug screening are required, according to the posting.

The job is based at 221 W. Parish St. in Sandusky. The description lists 40 hours a week with flexible hours and says applicants must be able to work evenings and possibly weekends.

The [county employment page]({jobs}) links its [online application]({apply}). Applications are also available through Human Resources at 2900 Columbus Ave., Suite 210, Sandusky. The posting says a completed county application must be received by Human Resources by the closing date. Questions can be directed to 419-627-7678.''',
         source_urls=[jobs,job,apply],
         notes='Recruitment brief. Visually inspected all three scanned PDF pages. Posting Nov. 9, 2026; Dec. 9 at 4:30 p.m. closing; pay and qualifications match current index. Do not infer a new position, vacancy count, shortage or reason for recruitment from posting number 2026-059. Evening/possible weekend requirement retained. No personal applicant data collected and no form submitted. No cleared subject image.'),
]
alternates = {
    'rudolph': ['Joseph Rudolph to lead Sandusky schools transportation department', 'Sandusky district announces new transportation supervisor'],
    'genoa': ['Genoa trail project sets Nov. 24 consultant deadline', 'Planned Genoa trail extension includes Packer Creek bridge'],
    'social-worker': ['Erie County social services worker applications due Dec. 9', 'County job posting lists $21.36 hourly pay after probation'],
}
for s in stories:
    s.update(status='ready', image={'status':'none'})
    assert len(s['summary']) < 160
    draft = '# Headlines\n\n' + '\n'.join(f'{i}. {h}' for i,h in enumerate([s['headline'],*alternates[s['key']]],1))
    draft += '\n\n# Story\n\n'+s['body']+'\n\n# Notes\n\n'+s['notes']+'\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE\n'
    (directory/'drafts'/(s['key']+'.md')).write_text(draft,encoding='utf-8')
events=[dict(key='sediments',slug='lake-erie-ancient-sediments-webinar-november-18-2026',status='ready',title='Freshwater Science: Lake Erie ancient sediments',summary='Beverly Saylor discusses research into 5,000 years of Lake Erie environmental history.',description='Ohio Sea Grant hosts a free webinar with Case Western Reserve University researcher Beverly Saylor about Central Basin sediment cores. Registration is required to receive login information.',category='classes',starts_on='2026-11-18',start_time='12:00',ends_on=None,end_time='12:30',hours_note='',venue='Online',address='',community='Lake Erie region',organizer='Ohio Sea Grant',organizer_url='https://ohioseagrant.osu.edu/',cost='Free; registration required for login information',source_url=webinar,image={'status':'none'},notes='Calendar candidate only, not part of the authorized news-story import. No event today. Captioning/accessibility terms not supplied; do not assume them.')]
previous=json.loads((directory.parent/'2026-11-11/research.json').read_text(encoding='utf-8'))
keep = {'Kozak educator award', 'Perkins Doerzbach demolition appeal outcome', 'Invasive species buyback', 'Winter Crisis assistance', 'Bass regulation changes', 'Erie County school healthcare grant', 'Erie health needs assessment', 'Monroeville variance hearing Thursday', 'ODOT Sandusky County traffic advisory'}
held=[dict(item, missing='Carry-forward unless today\'s review says otherwise: '+item['missing']) for item in previous['held_leads'] if item['topic'] in keep]+[
    dict(topic='Friends of the Huron County Dog Warden website',source_url='https://fhcdw.org/',missing='New source found from local news lead. Live organizer site confirms support group and donation methods but not its launch date; verify through dated organizer announcement before calling the site newly launched.'),
    dict(topic='Sandusky planetarium November programs',source_url='https://www.facebook.com/SanduskyCitySchools',missing='Official featured post lists Nov. 15 shows and weather-dependent Nov. 19 observatory night. Verify current district occurrence details, admission and access before calendar import.'),
]
baseline=json.loads((directory/'evidence/existing-content.json').read_text(encoding='utf-8'))
packet=dict(date='2026-11-12',scope='Verified research and drafts. Publisher expressly authorized local news-story import, production sync and Facebook queue; calendar candidate remains for review.',compared_against={'articles':len(baseline['articles']),'events':len(baseline['events'])},stories=stories,events=events,updates=[],featured=[],held_leads=held,new_sources=[dict(name='Village of Genoa',url=genoa,logged_in_news_sources=True),dict(name='Friends of the Huron County Dog Warden',url='https://fhcdw.org/',logged_in_news_sources=True)])
(directory/'research.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
