"""Build the verified October 29 story-only packet before any import."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory

directory = editorial_directory('2026-10-29')
assert not (directory / 'local-import-pending.json').exists()
baseline = json.loads((directory / 'evidence/existing-content.json').read_text(encoding='utf-8'))
stories = [
    {
        'key': 'shrink', 'slug': 'ohio-boat-shrink-wrap-recycling-south-bass-island-october-2026',
        'section': 'outdoors', 'community': 'Lake Erie region',
        'headline': 'Ohio boat-wrap recycling collects 66,000 pounds; South Bass Island joins effort',
        'summary': 'Ohio Sea Grant reports more than 66,000 pounds collected statewide in 2026, including a new South Bass Island effort that diverted 1,400 pounds.',
        'body': """Ohio's boat shrink-wrap recycling partners collected more than 66,000 pounds of plastic in 2026, including a new South Bass Island effort that diverted 1,400 pounds, Ohio Sea Grant reports.

The [agency's report](https://ohioseagrant.osu.edu/news/2026/l3b0q/ohio-clean-marinas-program-partners-divert-66000-pounds-boat), published Tuesday and updated Wednesday, describes a way for Lake Erie boaters and marinas to recycle the plastic used to protect boats during winter storage.

The statewide material will be recycled into guardrail blocks for Ohio highways, according to the report. The South Bass Island collection included residents' boat shrink wrap and pallet wrapping.

Island partners included Bret Klun, manager of The Keys and Park Place Boat Club, and Michael Pucak, manager of South Bass Island State Park. Ohio Sea Grant describes the summer collection as the Clean Marinas program's first collaboration of its kind with the Put-in-Bay community.

The Lorain County Solid Waste District also collected, cleaned and prepared nearly 10,000 pounds of shrink wrap, the agency says.

Recycling requires removing nylon straps, zippers, access doors and other material that can contaminate the plastic, according to Maria D'Amico, Ohio Sea Grant's Clean Marinas coordinator for the Lake Erie Basin.

The report links to designated collection locations. Boaters can ask about participation and preparation requirements at ohiocleanmarinas@osu.edu.""",
        'source_urls': ['https://ohioseagrant.osu.edu/news/2026/l3b0q/ohio-clean-marinas-program-partners-divert-66000-pounds-boat'],
        'image': {'status': 'none'},
        'notes': 'Brief/press-release rewrite. Published Oct. 27, modified Oct. 28, 2026. Statewide and island totals are attributed, not independently audited. Collection occurred this summer, not this week. No current drop-off hours, fees or universal acceptance promised. No quotations or unlicensed photos.',
        'alternatives': ['South Bass Island recycling effort diverts 1,400 pounds of plastic', 'Ohio Sea Grant reports boat-wrap recycling gains in Lake Erie communities']
    },
    {
        'key': 'email', 'slug': 'monroeville-government-email-switch-gov-october-2026',
        'section': 'local', 'community': 'Monroeville',
        'headline': 'Monroeville switches government email to .gov',
        'summary': 'The village changed its email system Oct. 21 and says its website will follow. The administrative office remains closed through Friday.',
        'body': """Monroeville has changed its government email system from .com to .gov and says its website will make the same switch.

The Huron County village's [homepage notice](https://www.monroevilleohio.com/) dates the email change to Oct. 21. It gives no date for the website conversion, and the village's website remained available at monroevilleohio.com Thursday.

The administrative office is closed through Friday for staff training. The village says staff will respond to emails and voicemails when the office reopens Monday.

Residents can use the office drop box for payments and paperwork during the closure. The office is at 21 N. Main St.; the listed phone numbers are 419-465-2922 and 419-465-4443.""",
        'source_urls': ['https://www.monroevilleohio.com/'],
        'image': {'status': 'none'},
        'notes': 'Service brief. Email system change explicitly dated Oct. 21, 2026; no announcement date inferred. No individual email address, forwarding behavior or completed website conversion inferred. Closure is context already covered, not a separate new story. Existing village file photo could illustrate the town but does not show the email system; no lead image selected.',
        'alternatives': ['Monroeville changes email domain; website move to follow', 'Monroeville announces .gov email switch']
    }
]
for story in stories:
    story['status'] = 'ready'
    assert story['slug'] not in {a['slug'] for a in baseline['articles']}
    assert len(story['summary']) <= 160
    facts = ('Statewide 2026 total: more than 66,000 pounds; island total: 1,400 pounds; Lorain total: nearly 10,000 pounds; guardrail blocks are future use. Dates and names checked against saved shrink.txt.'
             if story['key'] == 'shrink' else 'Who: Village of Monroeville, Huron County. What: .com to .gov email system. When: Oct. 21. Website change date unspecified. Office closure Oct. 28-30; reopening Nov. 2. Address and phones checked against saved monroeville.txt.')
    output = '# Headlines\n\n' + '\n'.join(f'{i+1}. {h}' for i,h in enumerate([story['headline'], *story.pop('alternatives')]))
    output += '\n\n# Story\n\n' + story['body'] + '\n\n# Notes\n\n' + facts + '\n\n' + story['notes']
    output += '\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE\n\nAccuracy, lede, order, attribution, fairness, neutral voice, AP and house style checked against the saved primary page. No unresolved gaps in this limited scope.\n'
    (directory / 'drafts' / (story['key'] + '.md')).write_text(output, encoding='utf-8')
previous = json.loads((directory.parent / '2026-10-28/research.json').read_text(encoding='utf-8'))
packet = {
    'date': '2026-10-29',
    'scope': 'Verified review packet; user separately authorized local import, production sync and Facebook queuing in this conversation. Publication results recorded separately.',
    'compared_against': {'articles': len(baseline['articles']), 'events': len(baseline['events'])},
    'stories': stories, 'events': [], 'updates': [], 'featured': [],
    'held_leads': previous['held_leads'][:6] + [
        {'topic': 'Sandusky Bay Pathway member mixer', 'source_url': 'https://www.facebook.com/cityofsandusky', 'missing': 'Expanded official share describes a discussion, but no new funded construction decision or dated project milestone verified. Hold rather than pad a mixer into an infrastructure story.'},
        {'topic': 'District leadership search', 'source_url': 'https://news.google.com/', 'missing': 'Secondary headline only; district identity, vacancy and application terms not verified from a primary record.'},
        {'topic': 'Monroeville blood drive', 'source_url': 'https://www.monroevilleohio.com/', 'missing': 'Nov. 6 calendar label lacks appointment hours, venue and donor access details; not imported.'},
        {'topic': 'ODNR recycling collection sheet', 'source_url': 'https://ohiodnr.gov/discover-and-learn/land-water/clean-marinas/shrink-wrap-recycling', 'missing': 'Sea Grant links state collection guidance, but current local acceptance hours and fees not independently verified; no drop-off schedule published.'}
    ], 'new_sources': []
}
(directory / 'research.json').write_text(json.dumps(packet, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
review = f"""# Oct. 29, 2026 news budget

Compared {len(baseline['articles'])} stories, {len(baseline['events'])} events and {len(baseline['media'])} library images against yesterday's packet. Two verified new briefs; no new calendar additions or verified changes to existing coverage. The editor authorized local dev, production sync and Facebook queuing. This packet precedes those operations; see the separate publication record for results.

## Best new stories

| Priority | Story | Why today | Readiness and image |
| --- | --- | --- | --- |
| 1 | [Ohio boat-wrap recycling collects 66,000 pounds; South Bass Island joins effort](drafts/shrink.md) | Oct. 27 report updated Oct. 28; local island participation and winter-storage relevance | Ready; no cleared subject photo |
| 2 | [Monroeville switches government email to .gov](drafts/email.md) | Newly identified service change dated Oct. 21; office closure makes contact guidance useful now | Ready; no subject photo selected |

[Ohio Sea Grant's full report](https://ohioseagrant.osu.edu/news/2026/l3b0q/ohio-clean-marinas-program-partners-divert-66000-pounds-boat) supports the figures, names and preparation requirements. The collection happened this summer, not this week. The material is destined for guardrail blocks; processing completion is not asserted. Its absolute publication and modification timestamps are saved in evidence/shrink.html and shrink.txt. No unsupported claim about measured local water-quality improvement.

[Monroeville's homepage](https://www.monroevilleohio.com/) explicitly dates the email-system change Oct. 21. The website migration remains future, with no date. No forwarding or individual mailbox assumptions. The office closure is useful context from the same source and already covered elsewhere; it is not counted as another story. Closure ends Friday, reopening Monday, Nov. 2. No invented public announcement date.

Both drafts include three headlines, a verified fact inventory, Newsroom Write output and Check mode with no unresolved flags. This run found two publishable briefs; additional volume would require unresolved reporting or duplicate coverage.

## Images and featured stories

All library captions were reviewed for subject matches. A Monroeville street file photo is available but does not depict the email change. No boat-wrap collection image with verified reuse permission was found. No social or source photo reused; use the standard masthead previews. No new featured selection recommended.

## Calendar and existing coverage

No new verified calendar additions. Today's existing events remain listed. Huron's leaf schedule, Sandusky volunteers, grants and GLCAP board nominations are duplicates and were excluded. No verified Camp Street completion or Perkins appeal decision; no update inferred from elapsed dates.

## Useful new sources

Scouted ODNR's boat shrink-wrap program and its collection-location sheet via Sea Grant, plus Huron County health and Oak Harbor. No newly verified source added to the directory: ODNR acceptance details need another check, and the other sources are already listed. The useful new source guidance is an in-place update to the existing Ohio Sea Grant entry in docs/news-sources.md.

## Held leads and source checks

Carried forward Christmas assistance, Winter Crisis, invasive buyback and the two infrastructure/legal follow-ups. The CACEHR page still links a 2022 release and gives conflicting season dates; no current local season confirmation. See research.json for missing facts. No police allegations reused from radio or other outlets.

Targeted source sweep: Sandusky, Huron, Perkins, Sandusky schools, GSP, Huron County Growth Partnership, GLCAP, Ohio Sea Grant, Erie MetroParks, Monroeville, parish, Norwalk, BGSU Firelands, Huron County health and Oak Harbor. Some requests returned 403; access failures are not evidence of no news. This is a targeted sweep, not every source in the directory.

Signed-in browser checks: city Facebook, Erie health Facebook, city X, Google News and Facebook event search. City Facebook's latest expanded share describes the pathway mixer; held pending a distinct project development. X's Camp Street post still supplies a schedule, not completion. Erie health's new visible Vermilion item needs full service-change verification. Google News still surfaces the June Koch acquisition as fresh and a dredging photo lead; neither established distinct verified news. Facebook events yielded no usable verified addition. No messages, comments, reactions, follows or votes.

## Evidence and validation

Full primary HTML and extracted text, access times and SHA-256 checksums are retained in evidence/sources.json and additional-sources.json. No email or image permission request sent. Publication utilities retain write-intent journals, exact SQL and validation separately. No schema, code deployment, commit, push or version bump is part of this content publication.
"""
(directory / 'review.md').write_text(review, encoding='utf-8')
print('Prepared two verified stories:', directory)
