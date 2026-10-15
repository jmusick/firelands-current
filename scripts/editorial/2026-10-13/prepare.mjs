import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-13');
if (existsSync(dir + 'import.json')) throw new Error('Preserve the imported package.');
mkdirSync(dir + 'evidence', { recursive: true });
mkdirSync(dir + 'images', { recursive: true });
const sources = {
  library: 'https://www.sanduskylib.org/',
  health: 'https://eriehealthohio.com/erie-county-health-department-appoints-tondra-frisby-as-director-of-youth-engagement/',
  release: 'https://eriehealthohio.com/wp-content/uploads/2026/10/Tondra-Youth-scaled.jpg.webp',
  camp: 'https://www.rbhayes.org/news/2026/09/28/general/tour-civil-war-camp-meet-reenactors-see-band-on-horseback-more-at-civil-war-winter-camp/',
  symphony: 'https://www.firelandssymphony.com/events/2026_10_18-curtain-up/',
  parade: 'https://www.scs-k12.net/protected/EventView.aspx?id=80GGBUBI2',
  astronomy: 'https://www.scs-k12.net/protected/EventView.aspx?id=80GGBUGGY',
  planetarium: 'https://www.scs-k12.net/SanduskyPlanetarium.aspx',
  stroll: 'https://www.rbhayes.org/news/2026/09/11/general/brush-pet-mini-horses-at-spiegel-grove-stroll-on-oct.-13/',
  friends: 'https://friendsowc.org/friends-of-old-woman-creek-present-echoes-of-the-estuary',
  tickets: 'https://app.arts-people.com/?show=346003',
};
const pack = { date: '2026-10-13', articles: [
  {
    slug: 'sandusky-library-construction-closure-october-15-2026',
    headline: 'Sandusky Library to close Thursday for construction',
    summary: 'The library announces an Oct. 15 closure but does not describe the construction work or give a reopening time.',
    section: 'local', community: 'Sandusky', image: 'library',
    body: `Sandusky Library will close Thursday, Oct. 15, for construction, according to a notice on the [library's website](${sources.library}).\n\nThe announcement does not describe the work or give a reopening time. Readers planning a visit should check the library's website for updates.`,
  },
  {
    slug: 'erie-county-tondra-frisby-youth-engagement-director-2026',
    headline: 'Erie County health department names Tondra Frisby to lead youth outreach',
    summary: 'The new director of youth engagement will develop outreach for young people and mental health training for adults who work with them.',
    section: 'local', community: 'Erie County', image: null,
    body: `Erie County Health Department has hired Tondra Frisby for a new leadership role overseeing youth outreach and partnerships supporting young people's mental health.\n\nFrisby will serve as director of youth engagement, according to a [department announcement posted Oct. 12](${sources.health}). The [attached news release](${sources.release}) is dated Sept. 30.\n\nThe department says she will develop programs for children and teenagers about public health, preventive wellness and personal safety. She will also lead youth mental health training for parents, educators, coaches and community leaders, with a focus on recognizing emotional distress and responding effectively.\n\nThe release describes Frisby's experience in community advocacy, youth mentorship and leadership in the Sandusky area. It does not give a schedule for the new programs or training sessions.\n\nFor information about youth programs and upcoming training, call the Erie County Health Department at 567-867-5174.`,
  },
  {
    slug: 'hayes-civil-war-winter-camp-october-24-2026',
    headline: 'Hayes Civil War camp to offer free performances and paid tours Oct. 24',
    summary: 'The Fremont event includes a band on horseback, Model T rides and reenactments. Camp tours cost extra; home and museum admission is separate.',
    section: 'community', community: 'Fremont', image: 'hayes',
    body: `Civil War reenactors, a band on horseback and Model T rides will return to Spiegel Grove in Fremont on Saturday, Oct. 24, for Hayes Presidential Library & Museums' annual winter camp.\n\nBand performances, rides, military demonstrations and children's activities are free, according to the [organizer's schedule](${sources.camp}). Camp tours require tickets.\n\nThe 2nd Cavalry Brigade Brass Band will perform at 10:30 a.m. and 1:30 p.m. Model T rides run from 10 a.m. to 5 p.m.; children's activities run from 10 a.m. to 3:30 p.m. Events are outdoors.\n\nCamp tours cost $10 for ages 13 and older and $7 for ages 6-12. Members pay $8 and $5, respectively. Children 5 and younger are admitted free. Morning and afternoon tour times appear on the organizer's page.\n\nOnline ticket sales end at 11:59 p.m. Oct. 23. Tickets may be sold at the event if available.\n\nCamp tickets do not include the Hayes Home or museum. The organizer offers a 20% discount that day on site passes covering both.`,
  },
  {
    slug: 'firelands-symphony-curtain-up-october-18-2026',
    headline: 'Firelands Symphony to open season with Broadway music Sunday',
    summary: 'Vocalist Tricia Tanguy joins the orchestra Oct. 18 in Huron. Tickets are $44 for adults and $5 for students.',
    section: 'community', community: 'Huron', image: null,
    body: `Firelands Symphony Orchestra will open its season with a Broadway program Sunday, Oct. 18, at Sawmill Creek Convention Center in Huron.\n\nVocalist Tricia Tanguy will join the orchestra for “Curtain Up!” at 4 p.m., according to the [orchestra's event page](${sources.symphony}).\n\nTickets cost $44 for adults and $5 for students. Seating is general admission. The convention center is at 400 Sawmill Creek Drive West, and parking is available.\n\nThe concert is included in the orchestra's full-season subscription and is available through partial subscriptions. Tickets can be purchased through the event page.\n\nThe announcement describes a program of Broadway songs but does not list individual selections or a concert end time.`,
  },
  {
    slug: 'sandusky-homecoming-parade-october-14-2026',
    headline: 'Sandusky homecoming parade set for Wednesday',
    summary: 'The school district lists a 5:30 p.m. start Oct. 14 at the Shelby Street city boat launch. The parade route is not announced in the listing.',
    section: 'schools', community: 'Sandusky', image: 'sandusky',
    body: `Sandusky City Schools lists its homecoming parade for Wednesday, Oct. 14, starting at 5:30 p.m. at the Shelby Street city boat launch.\n\nThe [district calendar](${sources.parade}) identifies the location as 101 Shelby St. and lists an event window ending at 8 p.m. That window does not establish how long the procession itself will last.\n\nThe listing does not give a parade route, road closures or spectator instructions. Check the district's website for updates before heading downtown.`,
  },
], events: [], images: [
  { key: 'library', filename: 'sandusky-library-2011.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:Sandusky_Library.jpg', download_url: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Sandusky_Library.jpg', license: 'Public domain', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/', credit: 'Nyttend / Wikimedia Commons / Public domain', alt: 'The stone front of Sandusky Library stands behind bare trees and a lawn.', caption: 'Sandusky Library, photographed Dec. 28, 2011. File photo; this does not show the current construction.' },
  { key: 'hayes', filename: 'hayes-home-spiegel-grove-2005.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:Spiegel_Grove_(Rutherford_B._Hayes_Summer_Home).jpg', download_url: 'https://upload.wikimedia.org/wikipedia/commons/3/32/Spiegel_Grove_%28Rutherford_B._Hayes_Summer_Home%29.jpg', license: 'Public domain', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/', credit: 'Shadow2700; edited by Jim Evans / Wikimedia Commons / Public domain', alt: 'A tree-lined drive leads to the Hayes Home at Spiegel Grove in Fremont.', caption: 'The Hayes Home at Spiegel Grove, photographed Aug. 23, 2005; image edited in 2020. Historical file photo, not a photograph of a 2026 program.' },
  { key: 'sandusky', existing_id: '45a371b4-c867-4dcd-a7e3-4293695b5415', source_url: 'https://commons.wikimedia.org/wiki/File:Sandusky,_Ohio_-_20201212_-_02_-_West_Water_Street.jpg', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', credit: 'Andre Carrotflower / Wikimedia Commons / CC BY-SA 4.0' },
] };
function event(slug, title, summary, fields) {
  return { slug, title, summary, description: '', category: 'community', starts_on: '2026-10-18', start_time: null, end_time: null, ends_on: null, hours_note: '', venue: '', address: '', community: '', organizer: '', organizer_url: '', cost: '', link: '', image: null, ...fields };
}
pack.events.push(
  event('spiegel-grove-mini-horses-october-13-2026', 'Mini horses at Spiegel Grove Stroll', 'Brush and pet miniature horses during a free lunchtime visit.', { starts_on: '2026-10-13', start_time: '12:00', end_time: '13:00', category: 'family', venue: 'Spiegel Grove, Hayes Presidential Library & Museums', address: 'Buckland Avenue', community: 'Fremont', organizer: 'Hayes Presidential Library & Museums', organizer_url: 'https://www.rbhayes.org/', cost: 'Free', link: sources.stroll, image: 'hayes', description: `Mini Wish Equine Wellness brings miniature horses to a designated area of the grounds. Keep dogs outside that area. Stroll check-in is by the museum's north-side columns. [Organizer announcement](${sources.stroll}). The file photo shows the estate, not the miniature horses.` }),
  event('sandusky-homecoming-parade-october-14-2026', 'Sandusky homecoming parade', 'The district lists a 5:30 p.m. start at the Shelby Street boat launch.', { starts_on: '2026-10-14', start_time: '17:30', end_time: '20:00', category: 'community', venue: 'Shelby Street city boat launch', address: '101 Shelby St.', community: 'Sandusky', organizer: 'Sandusky City Schools', organizer_url: 'https://www.scs-k12.net/', cost: 'Not stated', link: sources.parade, description: `The district calendar lists an event window of 5:30 to 8 p.m., not a verified procession duration. The route, road closures and spectator instructions are not specified. [District listing](${sources.parade}).` }),
  event('sidney-frohman-halloween-astronomy-october-18-2026', 'Halloween Astronomy at Sidney Frohman Planetarium', 'A planetarium program for ages 10 and older.', { start_time: '13:00', end_time: '14:00', category: 'classes', venue: 'Sidney Frohman Planetarium', address: '2130A Hayes Ave., behind Sandusky High School', community: 'Sandusky', organizer: 'Sandusky City Schools', organizer_url: 'https://www.scs-k12.net/', cost: 'Not stated', link: sources.astronomy, description: `The [district calendar](${sources.astronomy}) verifies the date, hours and age guidance but does not state admission or registration terms. For details, contact the [planetarium](${sources.planetarium}) at 419-984-1044.` }),
  event('firelands-symphony-curtain-up-october-18-2026', 'Firelands Symphony: Curtain Up!', 'Broadway music with guest vocalist Tricia Tanguy.', { start_time: '16:00', category: 'music', venue: 'Sawmill Creek Convention Center', address: '400 Sawmill Creek Drive West', community: 'Huron', organizer: 'Firelands Symphony Orchestra', organizer_url: 'https://www.firelandssymphony.com/', cost: '$44 adults; $5 students', link: sources.symphony, performer: 'Firelands Symphony Orchestra', performer_type: 'PerformingGroup', ticket_price: '44', ticket_url: sources.tickets, description: `General admission seating; parking available. Guest vocalist: Tricia Tanguy. The concert is included in full-season subscriptions and available through partial subscriptions. End time and individual song selections are not announced. [Organizer details and ticket link](${sources.symphony}).` }),
  event('hayes-civil-war-winter-camp-october-24-2026', 'Civil War Winter Camp at Spiegel Grove', 'Free performances and Model T rides; paid camp tours.', { starts_on: '2026-10-24', start_time: '10:00', end_time: '17:00', category: 'arts', venue: 'Spiegel Grove, Hayes Presidential Library & Museums', address: 'Buckland Avenue', community: 'Fremont', organizer: 'Hayes Presidential Library & Museums', organizer_url: 'https://www.rbhayes.org/', cost: 'Activities free; camp tours $10 ages 13+, $7 ages 6-12; ages 5 and younger free. Member discounts.', link: sources.camp, image: 'hayes', description: `Public daytime activities include Model T rides from 10 a.m. to 5 p.m. and children's activities until 3:30 p.m. The 2nd Cavalry Brigade Brass Band performs at 10:30 a.m. and 1:30 p.m. Morning and afternoon camp tours require tickets; online sales close at 11:59 p.m. Oct. 23, with day-of tickets subject to availability. Home and museum admission is separate. Members have a separate 6-7 p.m. camp visit. Events are outdoors. [Full schedule and tickets](${sources.camp}).` }),
);
writeFileSync(dir + 'package.json', JSON.stringify(pack, null, 2) + '\n');
for (const article of pack.articles) writeFileSync(dir + article.slug + '.md', `# ${article.headline}\n\nBy JD\n\n${article.summary}\n\n${article.body}\n`);
const evidence = [];
for (const [name, url] of [...Object.entries(sources), ...pack.images.map(p => [p.key + '-permission', p.source_url])]) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = name + (name === 'release' ? '.webp' : '.html');
  writeFileSync(dir + 'evidence/' + file, bytes);
  evidence.push({ url, file, fetched_at: new Date().toISOString(), bytes: bytes.length });
}
for (const photo of pack.images.filter(p => p.download_url)) {
  const response = await fetch(photo.download_url);
  if (!response.ok) throw new Error(`${photo.download_url}: ${response.status}`);
  writeFileSync(dir + 'images/' + photo.filename, Buffer.from(await response.arrayBuffer()));
}
writeFileSync(dir + 'evidence/sources.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ directory: dir, articles: pack.articles.length, events: pack.events.length, new_images: 2, reused_images: 1 }));
