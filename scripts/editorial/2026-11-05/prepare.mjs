import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-11-05');
assert(!existsSync(dir + 'local-import-pending.json'), 'Inspect the import journal before changing copy');
const baseline = JSON.parse(readFileSync(dir + 'evidence/existing-content.json', 'utf8'));
const prior = JSON.parse(readFileSync(editorialDirectory('2026-11-04') + 'research.json', 'utf8'));
const vesselUrl = 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/new-research-vessel-walleye-launched-on-lake-erie';
const discountUrl = 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/vets-discount-year-round';
const termsUrl = 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-odnr/division-parks-watercraft/stay-overnight/state-parks-camping-discounts';
const jobsUrl = 'https://www.eriecounty.oh.gov/content.aspx?id=26854';
const pdfUrl = 'https://www.eriecounty.oh.gov/Downloads/2026-056%20-%20FT%20Deputy%20Clerk%20-%20Legal%20Division%20-%20Clerk%20of%20Courts%20ADA.pdf';
const responseUrl = 'https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIY300';

const stories = [
  {
    key: 'clerk', slug: 'erie-county-deputy-clerk-applications-november-6-2026', section: 'business', community: 'Erie County',
    headline: 'Erie County deputy clerk applications due Friday',
    alternatives: ['Erie County seeks deputy clerk at $19 an hour', 'Friday deadline approaches for Erie County clerk job'],
    summary: 'The full-time legal-division job pays $19 an hour. Applications are due to county Human Resources by 4:30 p.m. Nov. 6.',
    body: `Applications for a full-time deputy clerk position in the Erie County Clerk of Courts' legal division are due by 4:30 p.m. Friday, according to the county's [job posting](${pdfUrl}).

The position pays $19 an hour. The county's [current openings page](${jobsUrl}) lists Friday as the closing date; the detailed posting supplies the 4:30 p.m. deadline.

Minimum requirements include education equivalent to completion of 12th grade, two years of experience in a business or legal office and accurate typing at 50 words per minute. Erie County residents are preferred, and pre-employment testing is required, the posting says.

The county provides an [online employment application](https://www.eriecounty.oh.gov/protected/OnlineJobApplication.aspx). Applicants can contact Human Resources at 419-627-7678 or at 2900 Columbus Ave., Suite 210, in Sandusky to confirm submission requirements.`,
    source_urls: [pdfUrl, jobsUrl, 'https://www.eriecounty.oh.gov/protected/OnlineJobApplication.aspx'],
    notes: 'Brief. PDF page 1 visually verified. Its application paragraph retains a 3/12/10 date and an old Your Job Store address, so do not reproduce those obsolete instructions. The clear posting header gives Nov. 6, 2026, 4:30 p.m.; current county application page provides contact and online route. No annual salary inferred. No suitable cleared photo.',
    facts: 'Who: Erie County Clerk of Courts. What: full-time legal-division deputy clerk recruitment. When: Oct. 19 posting; Nov. 6, 2026, 4:30 p.m. deadline. Where: Erie County, Human Resources in Sandusky. Pay: $19/hour. Why/how: application deadline and listed qualifications; no reason for vacancy given. No quotes.'
  },
  {
    key: 'walleye', slug: 'sandusky-new-walleye-fisheries-research-vessel-november-2026', section: 'outdoors', community: 'Sandusky',
    headline: 'New Walleye research boat replaces Explorer in Sandusky',
    alternatives: ['Ohio christens new Lake Erie research boat in Sandusky', 'Sandusky fisheries station gets 55-foot research vessel'],
    summary: 'The 55-foot Walleye replaces the Explorer at the Sandusky Fisheries Research Station and will support western Lake Erie fish surveys.',
    body: `A new 55-foot research boat will support western Lake Erie fish surveys from Sandusky, replacing the Explorer at the Sandusky Fisheries Research Station, the Ohio Department of Natural Resources announced.

The Division of Wildlife christened the vessel, the Walleye, in Sandusky on Oct. 30, according to its [Monday announcement](${vesselUrl}). The agency uses research boats to gather data that help Ohio and other jurisdictions set annual harvest levels for walleye and yellow perch.

The aluminum-hull boat has twin diesel engines, equipment for handling trawls and gill nets, navigation and sonar systems, and covered space for research work. Construction began in 2024 at Andersen Boat Works in Douglas, Michigan, the agency said.

ODNR said the Walleye is more stable and maneuverable than the vessel it replaces and reduces noise and vibration for biologists. The announcement does not give the boat's cost or a date for its first survey.

Research crews monitor fish abundance, growth, age, diet and health through trawl, gill-net and acoustic surveys, according to the agency.`,
    source_urls: [vesselUrl],
    notes: 'Press-release rewrite. Announcement Nov. 2; christening Oct. 30, not the publication day. Performance claims attributed. No new catch limits or measured population change asserted. Editor-note photos are offered, but explicit reuse terms/credit not established; request permission rather than assuming state-government work is public domain.',
    facts: 'Who: ODNR Division of Wildlife. What: 55-foot aluminum-hull Walleye replaces Explorer. When: christened Oct. 30, release Nov. 2, 2026; construction began 2024. Where: Sandusky Fisheries Research Station, western Lake Erie; built in Douglas, Michigan. Why: surveys for fisheries management. How: twin diesels, net-handling hydraulics, sonar, covered work space. Cost and first survey date absent. No quotes.'
  },
  {
    key: 'veterans', slug: 'ohio-state-parks-year-round-military-discount-november-2026', section: 'community', community: 'Firelands region',
    headline: 'Ohio state parks add year-round 25% military discount',
    alternatives: ['Veterans, active-duty military get new Ohio parks discount', 'Ohio parks expand military discount to year-round stays'],
    summary: 'The discount starts this month for new reservations. Eligible guests must occupy the rental and show approved identification at check-in.',
    body: `Veterans and active-duty military members can receive a year-round 25% discount on overnight camping and rentals at Ohio state parks starting this month, the Ohio Department of Natural Resources announced Thursday.

The [new discount](${discountUrl}) applies to new reservations and cannot be combined with other offers. Food and merchandise are excluded, ODNR said.

The eligible veteran or service member must be present at check-in, occupy the campsite, cabin, lodge room or rental facility, and show approved identification. The agency's [discount requirements](${termsUrl}) limit use to one site at a time and say military customers do not have to live in Ohio.

For state-operated facilities, check availability through [Reserve Ohio](https://reserveohio.com/) or call 866-644-6727. ODNR directs Great Ohio Lodges guests to select the Hero Rate through [the lodges' website](https://greatohiolodges.com/) or call 800-282-7275. Travelers should confirm the eligible rate and documentation when booking.`,
    source_urls: [discountUrl, termsUrl],
    notes: 'Service brief. New Nov. 5 release distinguishes new-reservation benefit from separate disabled-veteran free-camping program, which is not described here. Eligibility and one-site restriction cross-checked against expanded program page. No booking submitted and no universal final price or availability promised. No suitable cleared photo.',
    facts: 'Who: veterans and active-duty military, ODNR state parks. What: year-round 25% overnight camping/rental discount. When: starts November, announced Nov. 5, 2026. Where: Ohio state parks. How: new reservations, approved identification, eligible occupant present, one site/time, no combination, food/merchandise excluded. Rates and availability need individual booking confirmation. No quotes.'
  }
].map(s => ({ ...s, status: 'ready', image: { status: 'none', notes: s.key === 'walleye' ? 'ODNR press photographs require explicit reuse terms and credit confirmation.' : 'No suitable cleared subject photo in existing library.' } }));

const old = baseline.articles.find(a => a.slug === 'sandusky-school-levy-unofficial-defeat-november-3-2026');
assert(old);
const updateBody = old.body.split('\n\n').slice(0, 3).join('\n\n') + `

In a [Wednesday response to the election](${responseUrl}), the district said administrators will review the budget and develop recommendations for the school board. Further reductions to staffing, programs, services and other operating expenses may be necessary, the statement said.

The district said it continues to face a gap between operating revenue and expenses. Its response does not identify particular cuts, a vote date or an implementation schedule.

Updated Nov. 5 with the district's post-election response.`;
const packet = {
  date: '2026-11-05', scope: 'Verified review packet; publisher separately authorized local import, production sync and Facebook queue in the opening request. Publication journals record outcomes.',
  compared_against: { articles: baseline.articles.length, events: baseline.events.length }, stories,
  events: [], updates: [{ slug: old.slug, headline: old.headline, summary: old.summary, change: 'Add Nov. 4 district response after levy defeat; preserve unofficial totals and original publication date.', proposed_copy: updateBody, source_url: responseUrl }],
  featured: [],
  held_leads: [
    { topic: 'Kozak educator award', source_url: 'https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIY3YI', missing: 'Current homepage identifies 2026, but release still lacks announcement/ceremony date. No verified social full timestamp obtained.' },
    { topic: 'Cedar Point 2027 opening date', source_url: 'https://www.cedarpoint.com/', missing: 'Google News surfaces a new secondary headline; primary announcement and exact calendar date still need verification.' },
    { topic: 'Ohio bass rule approval', source_url: 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news', missing: 'Live index confirms Oct. 29 approval notice; full approved text and local exceptions require reading. Aug. 27 proposal is not final rule evidence.' },
    ...prior.held_leads.filter(l => !/kozak/i.test(l.topic))
  ],
  new_sources: [{ name: 'Erie County current job openings and application', url: jobsUrl, logged_in_news_sources: true }]
};
writeFileSync(dir + 'research.json', JSON.stringify(packet, null, 2) + '\n');
for (const s of stories) writeFileSync(dir + `drafts/${s.key}.md`, `# Headlines\n\n1. ${s.headline}\n2. ${s.alternatives[0]}\n3. ${s.alternatives[1]}\n\n# Story\n\n${s.body}\n\n# Notes\n\n${s.facts}\n\n${s.notes}\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE\n`);
writeFileSync(dir + 'drafts/levy-update.md', `# Headlines\n\n1. ${old.headline}\n2. Sandusky schools to review budget after levy defeat\n3. District says further reductions may follow levy defeat\n\n# Story\n\n${updateBody}\n\n# Notes\n\nUpdate to existing election brief. Add the dated district response, which announces a review and possible reductions rather than particular approved cuts. Existing vote figures retained from prior verified reporting. No correction is needed: the earlier story described a pre-election warning accurately.\n\n# Flags\n\nNONE\n\n# Check mode\n\nNONE\n`);
console.log(JSON.stringify({ stories: stories.length, updates: packet.updates.length, events: 0 }));
