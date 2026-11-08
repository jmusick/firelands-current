"""Assemble verified November 6 copy and publication tools; no database writes."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

directory = editorial_directory('2026-11-06')
baseline = json.loads((directory / 'evidence/existing-content.json').read_text(encoding='utf-8'))
cedar = 'https://www.sixflags.com/cedarpoint/events/opening-day'
calendar = 'https://www.sixflags.com/cedarpoint/events'
governor = 'https://governor.ohio.gov/media/news-and-media/governor-dewine-announces-260-new-opportunity-zones-across-ohio'
development = 'https://development.ohio.gov/business/state-incentives/ohio-opportunity-zones'
turkey = 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/ohios-spring-2027-turkey-hunting-seasons-updated-bass-fishing-regulations-approved-by-wildlife-council'
harbor = 'https://www.army.mil/article/296582/sandusky_harbor_dredging_completed_benefits_local_beach_nourishment'

def story(key, slug, section, community, headlines, summary, body, urls, notes):
    result = dict(key=key, slug=slug, status='ready', section=section, community=community,
                  headline=headlines[0], summary=summary, body=body, source_urls=urls,
                  image={'status': 'none'}, notes=notes)
    assert len(summary) <= 160
    draft = '## Headlines\n\n' + '\n'.join(f'{i}. {h}' for i,h in enumerate(headlines, 1))
    draft += '\n\n## Story\n\n' + body + '\n\n## Notes\n\n' + notes
    draft += '\n\n## Flags\n\nNONE\n\n## Check mode\n\nNONE\n'
    (directory / 'drafts' / f'{key}.md').write_text(draft, encoding='utf-8')
    return result

stories = [
    story('cedar', 'cedar-point-2027-opening-day-may-1', 'business', 'Sandusky',
          ['Cedar Point to open May 1 for 2027 season', 'Cedar Point sets May 1 opener; Shores to follow May 29', 'Cedar Point posts 2027 opening and festival dates'],
          'The Sandusky amusement park lists May 1 as opening day. Cedar Point Shores is scheduled to open May 29.',
          f'''Cedar Point is scheduled to open May 1, 2027, giving visitors a date to plan for next season at the Sandusky amusement park.

The park's [opening-day announcement]({cedar}) identifies the date as a Saturday. Its [2027 event calendar]({calendar}) lists May 29 as opening day for Cedar Point Shores water park.

The calendar also schedules Barrels & Bites for June 4-27, Light Up the Point for July 3-4 and Boardwalk Nights for July 16-Aug. 15. Happy Friar's Fresh-Cut Fries Fest is listed for Sept. 10-12.

HalloWeekends' 30th anniversary season is scheduled for Sept. 16-Oct. 31.

Cedar Point says event dates and times are subject to change. Visitors should check the park's calendar and operating hours before making plans.''',
          [cedar, calendar], 'Brief. Future schedule, not a promise of individual ride availability. No opening hour or ticket price inferred. No verified Cedar Point subject photo in the existing library; masthead social fallback.'),
    story('zones', 'erie-huron-ottawa-sandusky-opportunity-zones-november-2026', 'government', 'Firelands region',
          ['Erie County gets 2 new Opportunity Zones; Huron, Ottawa and Sandusky get 1 each', 'New Opportunity Zone designations include 5 tracts in 4 Firelands counties', 'Ohio announces new investment-zone designations in Firelands counties'],
          'Federal designations take effect Jan. 1, 2027. Ohio says Erie County has two tracts; Huron, Ottawa and Sandusky counties each have one.',
          f'''Two Erie County census tracts and one each in Huron, Ottawa and Sandusky counties will become federal Opportunity Zones Jan. 1, 2027, Gov. Mike DeWine's office announced Thursday.

The areas are among 260 Ohio tracts approved by the U.S. Department of the Treasury, according to the [Nov. 5 announcement]({governor}). Lorain County has five approved tracts.

The federal program offers tax incentives intended to attract private investment in economically distressed areas. The designations do not announce particular local construction projects, investment amounts or new jobs.

The state says the new zones will remain in effect through 2036. A census tract is a defined geographic area used by the U.S. Census Bureau to collect population, housing and economic data.

The [Ohio Department of Development's program page]({development}) links the approved tract list and says the federal designation process is separate from the Ohio Opportunity Zones Tax Credit Program. Questions about the new designations can go to ohoppzonetc@development.ohio.gov.''',
          [governor, development], 'Brief. County counts verified in governor release; effective date and separate state-program warning verified on Development page. No tract boundaries, neighborhood names, tax eligibility advice, promised projects or job totals inferred. No generic downtown photo used because selected tract boundaries were not verified.'),
    story('turkey', 'ohio-spring-turkey-south-zone-april-24-may-23-2027', 'outdoors', 'Firelands region',
          ['Ohio sets April 24-May 23 spring turkey season for most counties', 'Firelands counties fall in April 24-May 23 turkey season', 'Ohio approves 2027 spring turkey hunting dates'],
          'The south-zone season covers most of Ohio, including Firelands counties. Separate dates apply in five northeast Ohio counties.',
          f'''Ohio's spring wild turkey hunting season will run April 24-May 23, 2027, in the south zone, which includes Firelands counties, the Ohio Department of Natural Resources announced.

The Ohio Wildlife Council approved the dates Oct. 28, according to the agency's [Oct. 29 announcement]({turkey}). The south zone covers 83 counties. The northeast zone consists of Ashtabula, Cuyahoga, Geauga, Lake and Trumbull counties and has a May 1-30 season.

In both zones, regular-season hunting hours will run from 30 minutes before sunrise until noon for the first nine days, then from 30 minutes before sunrise until sunset for the rest of the season, ODNR said.''',
          [turkey], 'Brief from a held lead, not a new Nov. 6 announcement. The release truncates the year on its south-zone youth line; youth dates are omitted. Bass changes held separately until Lake Erie exceptions and adopted text can be checked. No suitable cleared turkey photo in library.')
]
old = next(a for a in baseline['articles'] if a['slug'] == 'sandusky-harbor-dredging-beach-nourishment-october-2026')
photo = old['body'][old['body'].index('!['):old['body'].index('\n\nCrews')]
credit = old['body'][old['body'].index('*Photo:'):]
updated_body = f'''*Updated Nov. 6, 2026: The Army Corps of Engineers reports dredging finished Nov. 5; the original schedule called for completion Nov. 1.*

Crews have finished removing about 109,000 cubic yards of sediment from Sandusky Harbor, the U.S. Army Corps of Engineers announced Thursday.

The Corps' Buffalo District said work ended Nov. 5 under a $628,000 contract awarded in July to Michigan-based Morrish-Wallace Construction Co. Dredging began Oct. 6, according to its [completion announcement]({harbor}).

About 100,000 cubic yards went to a nearshore site, where currents can carry the material along the coastline for beach nourishment. Another 9,000 cubic yards went to a designated open-lake site, the Corps said.

{photo}

The work cleared the federal navigation channel's Moseley and Straight channels for commercial vessels, recreational boats and other harbor users. Authorized harbor depths range from 21 to 26 feet.

The Corps says dredging schedules depend on sediment buildup, available funding and federal navigation priorities.

{credit}'''
updates = [dict(slug=old['slug'], change='Replace scheduled dredging with confirmed Nov. 5 completion; retain original URL, publication date, discussion and uncropped licensed body photo.', headline='Sandusky Harbor dredging finishes; 100,000 cubic yards placed near shore', summary='The Army Corps of Engineers says the $628,000 project finished Nov. 5, with about 109,000 cubic yards removed.', proposed_copy=updated_body, source_url=harbor)]
previous = json.loads((directory.parent / '2026-11-05/research.json').read_text(encoding='utf-8'))
held = [h for h in previous['held_leads'] if not any(w in (h.get('topic','').lower()) for w in ['cedar point', 'turkey'])]
held.extend([
    dict(topic='Bass regulation changes', source_url=turkey, missing='Release confirms adoption and March 1 effective date, but read adopted text and Lake Erie exceptions before telling anglers which limits change.'),
    dict(topic='Berlin Township scouting', source_url='https://www.berlintwp.us/', missing='Rejected: this is Delaware County, outside coverage; not Erie County Berlin Township.'),
])
packet = dict(date='2026-11-06', scope='Research packet prepared before writes; publisher explicitly authorized local import, production sync and Facebook queue in opening request. Outcomes recorded separately.', compared_against={'articles':123, 'events':112}, stories=stories, events=[], updates=updates, featured=[], held_leads=held, new_sources=[dict(name='Ohio governor and Department of Development', url=development, logged_in_news_sources=True), dict(name='Cedar Point official events', url=calendar, logged_in_news_sources=True)])
(directory / 'research.json').write_text(json.dumps(packet, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(directory / 'drafts/harbor-update.md').write_text('## Headlines\n\n1. '+updates[0]['headline']+'\n2. Army Corps completes Sandusky Harbor dredging\n3. Sandusky Harbor project moves 100,000 cubic yards near shore\n\n## Story\n\n'+updated_body+'\n\n## Notes\n\nUpdate, not a duplicate story. Retain 2020 uncropped CC BY-ND body image, license links and library caption. No new Facebook post for this update. Completion differs from the original forecast; the update note makes this explicit. No beach named or physical nourishment outcome claimed.\n\n## Flags\n\nNONE\n\n## Check mode\n\nNONE\n', encoding='utf-8')

review = f'''# Nov. 6, 2026 news budget

Compared 123 published stories, 112 events and 56 library images. Three new briefs and one existing-story update are ready. This packet precedes database writes. The publisher requested local-dev import, production sync and Facebook queuing in the opening request; outcomes will be recorded in production-publication.md.

## First action: harbor completion

Update [our existing harbor story](https://firelandscurrent.com/news/{old['slug']}) with the [Army Corps' Nov. 5 completion report]({harbor}). The project finished Nov. 5 rather than its originally scheduled Nov. 1 date. Preserve the URL, publication date, discussion and unchanged 2020 licensed body photograph. Do not queue a duplicate Facebook post.

## Best new stories

| Priority | Proposed story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Erie and neighboring counties receive Opportunity Zones](drafts/zones.md) | Thursday announcement; government thin | Ready; no photo |
| 2 | [Cedar Point to open May 1](drafts/cedar.md) | Resolves yesterday's held lead; official 2027 calendar confirmed | Ready; no photo |
| 3 | [Ohio sets spring turkey dates](drafts/turkey.md) | Resolves adopted-season portion of held lead; outdoors thin | Ready; no photo |

The [governor release]({governor}) supplies county counts; [Development]({development}) confirms the effective date and distinguishes federal designations from the state tax-credit program. No neighborhood boundaries, promised construction or tax eligibility inferred. No generic downtown photo used without verifying its relationship to selected tracts.

[Cedar Point]({cedar}) establishes May 1, 2027, with [Shores and festival dates]({calendar}) separately listed. No prices, operating hours or individual ride availability inferred. Dates and times are subject to change.

[ODNR]({turkey}) dates council action Oct. 28 and announcement Oct. 29. The story is a follow-through on a held lead, not a new announcement today. South-zone youth year is truncated in the release; omit youth dates. Bass changes remain held for adopted text and Lake Erie exceptions.

## Featured and images

No feature changes recommended: no verified subject-appropriate lead photos for the new briefs. Existing harbor image stays an uncropped body figure under CC BY-ND 2.0. No images downloaded from social or uploaded; no permission requests sent. New stories use the masthead social fallback.

## Potential calendar additions

No ready additions and no events today identified in this targeted sweep. Existing November programs were checked against the baseline. Cedar Point dates appear in the news brief; no calendar import requested. Earlier Milan council and marina-workshop candidates remain in prior packets.

## Useful new sources

| Source | Leads supplied | How to use it |
| --- | --- | --- |
| [Ohio governor]({governor}) and [Development]({development}) | Local investment-zone designations | Friendly and portal URLs return 404 in scripted requests; signed-in browser reads current official text. County counts do not establish neighborhoods or investments. |
| [Cedar Point official events]({calendar}) | 2027 season, water park and festivals | Read the explicit year; event schedule does not establish daily operating hours. |

Entries added to docs/news-sources.md. Berlin Township scouting rejected the Delaware County look-alike at berlintwp.us; no outside-area hearing used.

## Held leads and source checks

Read yesterday's held leads first; remaining gaps are carried in research.json. Kozak recognition still lacks a verified award date. No inferred date from the Nov. 5-6 conference. Bass rule details need further verification. Broader election outcomes need district-wide primary returns.

Official websites swept: Sandusky, Huron, Milan, schools, Erie County jobs, Erie MetroParks, Sandusky County Parks, Sea Grant, GLCAP, Huron Growth Partnership, Greater Sandusky Partnership, Monroeville and Perkins. Most current items duplicate coverage. HTTP failure pages for health, Hayes, Oberlin, Port Clinton schools and Bay View are retained, not treated as evidence of no news. Sweep log and original responses in evidence/.

Signed-in city Facebook feed supplied today's harbor completion lead; expanded full post pointed to the Army release. City X still leads with the already-covered Election Day closure. Facebook event search for Sandusky returned no results. Google News confirmed Cedar Point and harbor leads; other headlines were not reused as reporting. This was a targeted sweep, not every listed social account.

## Validation and publication scope

Each draft received Write and Check passes: NONE unresolved flags. Briefs contain no invented quotes, prices, dates or reactions. Packet checker must pass before local import. Local/production story fields, account-linked JD bylines, discussion rows, source links, social metadata, section counts and queue records will be verified in publication journals. New posts are queued once; existing harbor update is not reposted. No migrations, version bump, commit, push or Worker deployment.
'''
(directory / 'review.md').write_text(review, encoding='utf-8')

# Reuse the reviewed publication workflow with today's scope and date guard.
source = (Path(__file__).parent.parent / '2026-11-05/publish.mjs').read_text(encoding='utf-8')
source = source.replace('2026-11-05', '2026-11-06').replace('Nov. 5', 'Nov. 6').replace('story packet and levy response', 'story packet and harbor completion').replace('post-election district response', 'harbor completion report')
source = source.replace("Date.parse('2026-11-06T16:30:00-05:00')", "Date.parse('2026-11-07T00:00:00-05:00')").replace('Clerk application deadline has passed; re-review before publication or queuing', 'Budget date has passed; re-review before publication or queuing')
(Path(__file__).parent / 'publish.mjs').write_text(source, encoding='utf-8')
print('Prepared three new briefs and one harbor update. No database writes.')
