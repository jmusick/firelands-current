import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-14');
assert(!existsSync(dir + 'package.json'), 'Preserve the prepared publication package.');
const research = JSON.parse(readFileSync(dir + 'research.json', 'utf8'));
mkdirSync(dir + 'images', { recursive: true });
const photo = research.photo_opportunities.find(photo => photo.story === 'bash');
const html = readFileSync(dir + 'evidence/photo.html', 'utf8');
const download = html.match(/<meta property="og:image" content="([^"]+)"/)[1].replaceAll('&amp;', '&');
assert(download.startsWith('https://thumb.wikimedia.org/') && download.includes('/1280px-thumbnail.jpg'));
const response = await fetch(download);
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
assert(bytes.length < 5 * 1024 * 1024 && bytes[0] === 0xff && bytes[1] === 0xd8);
writeFileSync(dir + 'images/tim-mcgraw-fleet-week-2012.jpg', bytes);
const slugs = {
  bash: 'the-bash-norwalk-2027-lineup-tickets-october-2026',
  'lewco-award': 'lewco-logistiq-regional-collaboration-award-2026',
  'perkins-hearing': 'perkins-doerzbach-demolition-appeal-hearing-october-27-2026',
};
const articles = research.stories.map(story => ({
  slug: slugs[story.key], headline: story.headline, summary: story.summary, body: story.body,
  section: story.section, community: story.community, image: story.key === 'bash' ? 'mcgraw' : null,
}));
const eventSlugs = {
  hike: 'creek-bend-creatures-night-hike-october-16-2026',
  archery: 'creek-bend-monster-archery-october-24-2026',
  tea: 'creek-bend-spilling-tea-october-28-2026',
  bingo: 'luscombe-fall-bingo-hike-november-5-2026',
  bash: 'the-bash-music-fest-norwalk-2027',
};
const descriptions = {
  hike: 'A nighttime trail walk to learn about nocturnal wildlife using red-light flashlights. Meet at Wilson Nature Center. All ages; registration required by Oct. 16. Weather dependent. The organizer identifies this program as not wheelchair accessible.',
  archery: 'Practice archery on monster targets with NASP bows and arrows. Ages 10 and older; registration required by Oct. 24. Meet on the event lawn. Weather dependent. The organizer identifies this program as not wheelchair accessible.',
  tea: 'An afternoon history program with tea, diary entries, photographs and letters about the 1950s. This session focuses on 1958. For teens and adults. Meet at the nature center; the program is at the Homestead House. Registration closes Oct. 27.',
  bingo: 'Receive a nature bingo card at the start of the hike and look for the listed items. A completed card earns a small prize. Meet in the parking lot and prepare for uneven trails. Registration closes Nov. 4.',
  bash: 'Russell Dickerson opens Thursday, Tim McGraw headlines Friday and Riley Green headlines Saturday. Public ticket sales begin Oct. 16, 2026, at 9 a.m. Advertised starting prices are $40 Thursday and $129 for Friday or Saturday single-day passes; final checkout totals are not specified. Admission, camping and parking have separate terms. The venue advertises a free parking option, while the organizer says parking passes are sold separately; check the selected pass. Individual performance and closing times are not announced.',
};
const summaries = {
  hike: 'Search for nocturnal wildlife on a free guided evening walk.',
  archery: 'A free archery program using monster targets for ages 10 and older.',
  tea: 'Explore life in 1958 through tea, diaries, photographs and letters.',
  bingo: 'Look for nature bingo items on a free guided hike.',
  bash: 'Three days of country music with Russell Dickerson, Tim McGraw and Riley Green.',
};
const events = research.events.filter(event => Object.hasOwn(eventSlugs, event.key)).map(event => ({
  slug: eventSlugs[event.key], title: event.title, summary: summaries[event.key],
  description: descriptions[event.key] + `\n\n[Organizer details and registration](${event.source_url}).`,
  category: event.key === 'bash' ? 'music' : event.key === 'tea' ? 'classes' : 'outdoors',
  starts_on: event.starts_on, start_time: event.start_time, end_time: event.end_time,
  ends_on: event.ends_on ?? null,
  hours_note: event.key === 'bash' ? 'Gates open at 6 p.m. Thursday and 3 p.m. Friday and Saturday. Performance and closing times are not announced.' : '',
  venue: event.key === 'hike' ? 'Creek Bend Farm — Wilson Nature Center' : event.key === 'tea' ? 'Creek Bend Farm — Homestead House' : event.venue,
  address: event.address, community: event.community,
  organizer: event.key === 'bash' ? 'Ride the Wave Productions / The Bash' : 'Sandusky County Park District',
  organizer_url: event.key === 'bash' ? 'https://thebashmusicfest.com/' : 'https://www.lovemyparks.com/',
  cost: event.cost, link: event.source_url, image: null,
}));
const source = 'https://x.com/cityofsandusky/status/2110046319444144612';
const parade = {
  slug: 'sandusky-homecoming-parade-october-14-2026',
  headline: 'Sandusky homecoming parade starts at 5:30 p.m.; Camp Street closes at 5',
  summary: 'The parade goes from the Shelby Street boat launch to Strobel Field today. Camp Street closes from 5 to 7 p.m., with brief rolling closures at intersections.',
  body: `Sandusky's homecoming parade starts at 5:30 p.m. Wednesday, Oct. 14, at the Shelby Street city boat launch and heads to Strobel Field.\n\nCamp Street will close from 5 to 7 p.m., with brief rolling closures at intersections as the parade passes, according to the [City of Sandusky's Oct. 13 notice](${source}).\n\nThe city asks drivers to avoid the area during the closure and use care near the route. Its [Facebook notice](https://www.facebook.com/photo/?fbid=1442654524659899&set=a.178941827697848) says access for residents and emergency vehicles will be maintained as needed.\n\nThe [school district's calendar](https://www.scs-k12.net/protected/EventView.aspx?id=80GGBUBI2) identifies the starting location as 101 Shelby St. and lists an event window ending at 8 p.m. That window does not establish how long the procession itself will last. The street closure window is separate from the parade's 5:30 p.m. start.`,
  event_description: `The parade starts at the Shelby Street city boat launch and heads to Strobel Field. The [city notice](${source}) says Camp Street closes from 5 to 7 p.m., with brief rolling intersection closures. Drivers should avoid the area and use care near the route. The district's 5:30–8 p.m. calendar window is not a verified procession duration.`,
};
const pack = { date: '2026-10-14', articles, events, parade, images: [{
  key: 'mcgraw', filename: 'tim-mcgraw-fleet-week-2012.jpg', source_url: photo.source_url,
  download_url: download, license: 'Public domain in the United States',
  license_url: 'https://creativecommons.org/publicdomain/mark/1.0/',
  credit: photo.credit, caption: photo.caption, alt: photo.alt,
}] };
writeFileSync(dir + 'package.json', JSON.stringify(pack, null, 2) + '\n');
for (const article of articles) writeFileSync(dir + 'drafts/' + article.slug + '.md', `# ${article.headline}\n\nBy JD\n\n${article.summary}\n\n${article.body}\n`);
console.log(JSON.stringify({ articles: articles.length, events: events.length, updated_parade: true, image_bytes: bytes.length, directory: dir }));
