import { mkdirSync, writeFileSync, existsSync, globSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-14');
if (existsSync(dir + 'research.json')) throw new Error('Preserve the existing editorial research.');
mkdirSync(dir + 'evidence', { recursive: true });
mkdirSync(dir + 'drafts', { recursive: true });

const db = new DatabaseSync(globSync('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite').find(path => !path.endsWith('metadata.sqlite')), { readOnly: true });
const baseline = {
  articles: db.prepare('SELECT slug, headline, section, summary, body FROM news_articles ORDER BY published_at DESC').all(),
  events: db.prepare('SELECT slug, title, starts_on, start_time FROM events ORDER BY starts_on DESC').all(),
};
db.close();
writeFileSync(dir + 'evidence/existing-content.json', JSON.stringify(baseline, null, 2) + '\n');

const sources = {
  city: 'https://www.cityofsandusky.com/',
  health: 'https://eriehealthohio.com/news-page/',
  perkins: 'https://perkinstownship.com/',
  huron: 'https://www.cityofhuron.org/',
  partnership: 'https://greatersandusky.com/',
  huronPartnership: 'https://huroncountyohio.com/',
  bgsu: 'https://www.bgsu.edu/firelands/news.html',
  terra: 'https://my.terra.edu/',
  parks: 'https://www.lovemyparks.com/',
  hike: 'https://reservations.lovemyparks.com/programs/6048/',
  archery: 'https://reservations.lovemyparks.com/programs/6002/',
  tea: 'https://reservations.lovemyparks.com/programs/6044/',
  bingo: 'https://reservations.lovemyparks.com/programs/6000/',
  dine: 'https://huronlibrary.libcal.com/event/16965642',
  cooking: 'https://huronlibrary.libcal.com/event/16461157',
  bash: 'https://thebashmusicfest.com/festival.html',
  lineup: 'https://thebashmusicfest.com/full-lineup.html',
  passes: 'https://thebashmusicfest.com/passes-info.html',
  festivalPass: 'https://thebashmusicfest.com/festival-pass.html',
  venue: 'https://www.summitmotorsportspark.com/featured-events/spring-classic',
  foundation: 'https://www.sanduskyccf.org/grant-guidance',
  radioLeads: 'https://www.wlkrclassic.com/2026/10/13/tuesday-october-13th-2026/',
  photo: 'https://commons.wikimedia.org/wiki/File:Flickr_-_Official_U.S._Navy_Imagery_-_Country_music_musician_Tim_McGraw_performs_a_private_concert_for_service_members_and_their_families_at_the_Beacon_Theatre_in_Manhattan_during_Fleet_Week_New_York_2012._(1).jpg',
};
const evidence = await Promise.all(Object.entries(sources).map(async ([key, url]) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const html = await response.text();
    const file = key + '.html';
    writeFileSync(dir + 'evidence/' + file, html);
    return { key, url, final_url: response.url, status: response.status, fetched_at: new Date().toISOString(), file, bytes: Buffer.byteLength(html) };
  } catch (error) {
    return { key, url, fetched_at: new Date().toISOString(), error: String(error) };
  }
}));
writeFileSync(dir + 'evidence/sources.json', JSON.stringify(evidence, null, 2) + '\n');

const stories = [
  {
    key: 'bash', section: 'community', community: 'Norwalk', status: 'Draft for review',
    headline: 'Tim McGraw, Riley Green to headline The Bash in Norwalk next summer',
    summary: 'The Aug. 12–14, 2027 festival at Summit Motorsports Park opens public ticket sales Friday. Thursday admission starts at $40; Friday and Saturday start at $129 each.',
    source_urls: [sources.venue, sources.lineup, sources.bash, sources.passes],
    body: `Tim McGraw and Riley Green will headline The Bash at Summit Motorsports Park in Norwalk next summer, with Russell Dickerson opening the three-day festival.\n\nThe festival runs Aug. 12–14, 2027. Public ticket sales begin at 9 a.m. Friday, Oct. 16, according to the [venue's announcement](${sources.venue}). Presales began Oct. 13.\n\nDickerson performs Thursday, Aug. 12; McGraw headlines Friday, Aug. 13; and Green closes the festival Saturday, Aug. 14. The [organizer's lineup](${sources.lineup}) also lists Chase Matthew, Parmalee, Muscadine Bloodline and Joe Nichols among the performers.\n\nThursday tickets start at $40. Single-day tickets for Friday and Saturday start at $129 each. Those are advertised starting prices; the announcement does not specify the final checkout total.\n\nSummit Motorsports Park is at 1300 Ohio 18. The [festival FAQ](${sources.bash}) lists gate opening times of 6 p.m. Thursday and 3 p.m. Friday and Saturday. Those are gate times, not individual performance times.\n\nCamping and multi-day packages will be available. The [pass information page](${sources.passes}) says admission, camping and parking are sold separately, while the venue also advertises a free parking option. Check the ticket pages for the terms of a particular pass.`,
    notes: 'The festival FAQ says children 10 and under enter free; the pass-information page says under 10 but then requires passes starting at 11. The venue explicitly says 10 and under. Leave the age boundary out of the brief unless clarified. The venue URL and page title retain Spring Classic wording, but the body explicitly identifies The Bash and 2027. The festival pass page still says information coming soon. Do not claim general sales are already open. Do not describe the older expansion of the festival as a newly announced relocation without a dated primary announcement.',
  },
  {
    key: 'perkins-hearing', section: 'government', community: 'Perkins Township', status: 'Notice brief for review; fuller reporting needs records and owner response',
    headline: 'Perkins trustees to hear appeal of Doerzbach Avenue demolition order Oct. 27',
    summary: 'The 8:30 a.m. hearing concerns a house at 220 Doerzbach Ave. The township says the owner requested an appeal after an August demolition order.',
    source_urls: ['https://www.facebook.com/photo/?fbid=1470056321889423&set=a.200889042139497'],
    body: `Perkins Township trustees have scheduled an Oct. 27 hearing on an appeal of a demolition order for a house at 220 Doerzbach Ave.\n\nThe hearing begins at 8:30 a.m. at the township administration building, 2610 Columbus Ave., according to a [public notice posted by the township](https://www.facebook.com/photo/?fbid=1470056321889423&set=a.200889042139497).\n\nThe notice says trustees adopted Resolution 2026-106 on Aug. 25, declaring the house unsafe and structurally defective and ordering its demolition. Property owner Minnie Matthews requested a hearing Sept. 21, according to the township.\n\nThe hearing is an opportunity to contest that order. The notice says parties with an interest in the property may appear, have a lawyer, present evidence and question witnesses.\n\nThe notice does not announce a decision on the appeal or a demolition date.`,
    notes: 'Official Facebook notice was visible as posted about one hour before the Oct. 14 browser check. Its image is a township logo, not an inspection photo. Attribute the condition finding to the township. Obtain the resolution, inspection report and owner response before developing a larger condition/enforcement story. The official notice cites ORC 505.86; this brief reports the notice and offers no legal interpretation.',
  },
  {
    key: 'lewco-award', section: 'business', community: 'Erie and Ottawa counties', status: 'Short award brief for review; job totals need follow-up',
    headline: 'LEWCO, LogistiQ and partners receive regional collaboration award',
    summary: 'Greater Sandusky Partnership recognized the companies and economic-development partners for an expansion spanning Erie and Ottawa counties.',
    source_urls: ['https://www.facebook.com/reel/3598352873679548/', 'https://www.co.ottawa.oh.us/Archive/ViewFile/Item/254'],
    body: `LEWCO, LogistiQ and their economic-development partners have received Greater Sandusky Partnership's 2026 Regional Collaboration Award for an expansion spanning Erie and Ottawa counties.\n\nThe partnership highlighted the award in an [Oct. 13 announcement](https://www.facebook.com/reel/3598352873679548/), describing more than $24 million in investment and more than 200 jobs associated with the project.\n\nRecognized partners include Ottawa County Improvement Corporation, Regional Growth Partnership, Team NEO, Ohio Department of Development, JobsOhio, Ohio Department of Transportation and the City of Sandusky.\n\nThe award announcement does not say how many of the jobs have been filled. It also does not establish a new investment commitment beyond the expansion being recognized.`,
    notes: 'Read the full organizer caption in the signed-in browser; the city shared the same video. Relative timestamp was 15 hours, with an Oct. 13, 2026 comment corroborating the current posting context. The 2026 meeting listing identifies Oct. 1; old featured videos refer to 2025 and 2024. Avoid assigning a new Oct. 13 award ceremony or treating the investment as newly committed. Ottawa County annual-report search evidence calls 208 jobs projected; download and read the relevant page before using the precise number in copy.',
  },
];

const events = [
  { key: 'dine', title: 'Dine to Donate for Friends of Huron Public Library', starts_on: '2026-10-14', start_time: null, end_time: null, community: 'Huron', venue: "Berardi's in Huron", address: null, cost: 'Meal purchases; donation percentage not stated', source_url: sources.dine, status: 'Candidate; verify restaurant hours and address before entry', notes: 'Library verifies the year and all-day listing. A portion of sales supports library programming. Do not imply free meals or invent the percentage.' },
  { key: 'cooking', title: 'Teen Cooking Challenge kit pickup', starts_on: '2026-10-15', start_time: null, end_time: null, community: 'Huron', venue: 'Huron Public Library', address: null, cost: 'Not stated', source_url: sources.cooking, status: 'Candidate; confirm pickup location/hours and the online-event boilerplate', notes: 'Grades 7–12. Registration required. Recipe is pumpkin cookies with cream-cheese frosting; kits are for use at home. Narrative says pickup during operating hours, but registration boilerplate calls it an online event. Do not present as an in-person cooking class. Availability must be rechecked.' },
  { key: 'hike', title: 'Creatures of the Night Hike', starts_on: '2026-10-16', start_time: '19:30', end_time: '21:00', community: 'Lindsey', venue: 'Creek Bend Farm, meet at Wilson Nature Center', address: '720 S. Main St., Lindsey, OH 43442', cost: 'Free', source_url: sources.hike, status: 'Verified candidate', notes: 'All ages; registration required by Oct. 16. Weather dependent. Red-light flashlight wildlife hike. Organizer marks the program not wheelchair accessible. Recheck space availability when entering.' },
  { key: 'archery', title: 'Monster Archery', starts_on: '2026-10-24', start_time: '14:00', end_time: '16:00', community: 'Lindsey', venue: 'Creek Bend Farm event lawn', address: '720 S. Main St., Lindsey, OH 43442', cost: 'Free', source_url: sources.archery, status: 'Verified candidate', notes: 'Ages 10 and older; NASP bows and arrows; registration required by Oct. 24. Weather dependent. Organizer marks it not wheelchair accessible.' },
  { key: 'tea', title: 'Spilling the Tea: 1958', starts_on: '2026-10-28', start_time: '13:30', end_time: '15:30', community: 'Lindsey', venue: 'Creek Bend Farm Homestead House; meet at nature center', address: '720 S. Main St., Lindsey, OH 43442', cost: 'Free', source_url: sources.tea, status: 'Verified candidate', notes: 'Teens and adults; registration closes Oct. 27. Tea, diary entries, photographs and letters about life in the 1950s, focusing this month on 1958.' },
  { key: 'bingo', title: 'Fall Bingo Hike', starts_on: '2026-11-05', start_time: '16:30', end_time: '18:00', community: 'Clyde', venue: 'The Woods at the Luscombe Farm, meet in parking lot', address: '2341 County Road 213, Clyde, OH 43410', cost: 'Free', source_url: sources.bingo, status: 'Verified candidate', notes: 'Registration closes Nov. 4. Uneven trails; small prize for a completed nature bingo card. Listed for youth, teens, adults and adult with child.' },
  { key: 'bash', title: 'The Bash Music Fest', starts_on: '2027-08-12', ends_on: '2027-08-14', start_time: null, end_time: null, community: 'Norwalk', venue: 'Summit Motorsports Park', address: '1300 Ohio 18, Norwalk, OH 44857', cost: 'Thursday from $40; Friday/Saturday single-day tickets from $129 each; packages separate', source_url: sources.venue, status: 'Verified future candidate; public sales open Oct. 16, 2026 at 9 a.m.', notes: 'Gate opening: 6 p.m. Thursday; 3 p.m. Friday/Saturday. Performance and closing times unannounced. For a single multi-day record, keep time fields blank and put gate times in hours_note. Check pass age/parking inconsistencies described in the story notes.' },
];
for (const event of events) {
  if (baseline.events.some(existing => existing.slug.includes(event.key) && existing.starts_on === event.starts_on)) throw new Error('Review possible event duplicate: ' + event.key);
}
const pack = {
  date: '2026-10-14', scope: 'Research and review drafts only; no database writes, publication, uploads or messages',
  compared_against: { articles: baseline.articles.length, events: baseline.events.length }, stories, events,
  urgent_update: { slug: 'sandusky-homecoming-parade-october-14-2026', source_url: 'https://x.com/cityofsandusky/status/2110046319444144612', notes: 'Update existing story and event: Camp Street closes 5–7 p.m. Oct. 14; route runs from Shelby Street boat launch to Strobel Field; brief rolling intersection closures. Facebook additionally says resident/emergency access maintained as needed. Preserve the district 5:30 p.m. start; the closure window is a different fact. No database update performed.' },
  held_leads: [
    { topic: 'Sycamore Line gas-line closure through Friday', source_url: sources.radioLeads, missing: 'Current city/utility primary confirmation. Secondary source says Lane Street–Milan Road, 7 a.m.–5:30 p.m. Do not confuse with 2018/2024 Facebook closures returned by search.' },
    { topic: 'Monroeville administrator resignation', source_url: sources.radioLeads, missing: 'Village notice, resignation letter, minutes or direct official response. Do not repeat background allegations from secondhand coverage.' },
    { topic: 'Terra State Spring 2027 nursing applications', source_url: sources.terra, missing: 'Application deadline, cohort capacity, admission criteria and fresh dated confirmation of no-wait-list statement. Current institutional announcement is useful for follow-up, not a guarantee of admission.' },
    { topic: 'Sandusky County Communities Foundation awards', source_url: sources.foundation, missing: 'Tonight’s Oct. 14, 5 p.m. celebration is confirmed in the grant timeline, but venue, public access and current recipients are not established. Do not list as a verified public event.' },
  ],
  photo_opportunities: [
    { story: 'bash', status: 'Reusable historical photo located and visually inspected; not downloaded or uploaded', source_url: sources.photo, original_source: 'https://www.flickr.com/photos/usnavy/7301788688/', license: 'U.S. Navy official-duty photograph; public domain in the United States. Commons additionally records an earlier Flickr CC BY 2.0 review.', credit: 'U.S. Navy / Mass Communication Specialist 1st Class Elisandro T. Diaz', caption: 'Tim McGraw performs at the Beacon Theatre in New York on May 28, 2012, during Fleet Week. File photo; not a photograph of The Bash or its Norwalk venue.', alt: 'Tim McGraw sings with his band onstage as a crowd of service members watches.', notes: 'Commons file ID 120528-N-LO372-861. Visually inspected the Commons original in the browser; the old Flickr static URL fails. The image is dark and audience-heavy, so it is a fallback rather than the strongest lead photo. Route any future upload through media validation.' },
    { story: 'perkins-hearing', status: 'No cleared scene photo', notes: 'Township post uses its logo. An original exterior photo from a public location could illustrate the address; avoid implying the image establishes structural condition.' },
    { story: 'lewco-award', status: 'Permission needed for organizer/company photos or video stills', notes: 'Do not reuse a frame from the award video without permission. An original exterior or cleared company-supplied photo would work.' },
    { story: 'parade-update', status: 'Existing licensed city file photo available', media_id: '45a371b4-c867-4dcd-a7e3-4293695b5415', notes: '2020 West Water Street photo already on the story. It shows neither the parade nor the closure. Best fresh photo opportunity is today’s parade; no social map reuse permission established.' },
  ],
};
writeFileSync(dir + 'research.json', JSON.stringify(pack, null, 2) + '\n');
for (const story of stories) writeFileSync(dir + 'drafts/' + story.key + '.md', `# ${story.headline}\n\nReview draft — ${story.section}; ${story.community}\n\n${story.summary}\n\n${story.body}\n\n---\n\nEditorial checks: ${story.notes}\n`);
console.log(JSON.stringify({ directory: dir, existing_articles: baseline.articles.length, existing_events: baseline.events.length, drafts: stories.length, event_candidates: events.length, evidence_requests: evidence.length, evidence_failures: evidence.filter(source => source.error || source.status !== 200).map(source => ({ key: source.key, status: source.status, error: source.error })) }, null, 2));
