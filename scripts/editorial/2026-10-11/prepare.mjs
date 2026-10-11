import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-11');
mkdirSync(dir + 'evidence', { recursive: true });
mkdirSync(dir + 'images', { recursive: true });
if (existsSync(dir + 'import.json')) throw new Error('Already imported; preserve the reviewed package.');
const calendar = 'https://www.norwalkoh.com/city-calendar';
const brochure = 'https://eriemetroparks.org/wp-content/uploads/2026/08/October-2026.pdf';
const hunt = 'https://eriemetroparks.org/the-great-pumpkin-hunt/';
const farm = 'https://chefs-garden.com/event/fall-fest/';
const pack = {
  date: '2026-10-11',
  articles: [
    {
      slug: 'norwalk-columbus-day-trash-council-october-2026',
      headline: 'Norwalk offices to close Monday; trash pickup delayed',
      summary: 'The city also has canceled its Oct. 13 council meeting. The next regular session is Oct. 20.',
      section: 'local', community: 'Norwalk', image: 'norwalk',
      body: `Norwalk city offices will close Monday, Oct. 12, for Columbus Day, and trash pickup will be delayed, according to the city's calendar.\n\nThe [official notice](${calendar}) does not specify the length of the trash delay. Residents should confirm their collection day with the city.\n\nThe city also lists Tuesday's council meeting as canceled. The next regular session is scheduled for 7:30 p.m. Oct. 20 at Norwalk Municipal Court.`,
    },
    {
      slug: 'erie-metroparks-great-pumpkin-hunt-october-2026',
      headline: 'Erie MetroParks pumpkin hunt sends visitors searching for cryptid clues',
      summary: 'Two clues are posted. The remaining clues are scheduled for Oct. 15, 22 and 29, with photos required to qualify for prizes.',
      section: 'outdoors', community: 'Erie County', image: 'pumpkins',
      body: `Erie MetroParks' Great Pumpkin Hunt is sending visitors onto park trails to solve clues and photograph hidden pumpkins, with the final clues scheduled for Oct. 29.\n\nThe [park district's hunt page](${hunt}) has posted the first two clues, dated Oct. 1 and 8. The next clues are scheduled for Oct. 15 and 22, followed by clues to the fifth pumpkin and the Great Pumpkin on Oct. 29.\n\nThis year's theme uses cryptids — legendary creatures — in a fictional mystery about stolen pumpkins. Each clue points participants toward a park and trail.\n\nParticipants must photograph themselves with all five pumpkins and the Great Pumpkin, then send the photos to behere@eriemetroparks.org. The district says the first person to submit the complete set wins; two other participants will be selected at random for prize packs.\n\nThe page does not list prize contents or a final submission deadline. Its introduction describes five pumpkins placed each week, while the detailed instructions and dated clues describe five pumpkins plus the Great Pumpkin for the hunt.`,
    },
    {
      slug: 'norwalk-halloween-parade-trick-or-treat-october-31-2026',
      headline: 'Norwalk to hold Halloween parade and two trick-or-treat sessions Oct. 31',
      summary: 'The uptown parade starts at 2 p.m. Neighborhood trick-or-treat runs from 6 to 7:30 p.m.',
      section: 'community', community: 'Norwalk', image: 'norwalk',
      body: `Norwalk's Halloween schedule pairs an uptown parade and merchant trick-or-treat with a separate evening session Saturday, Oct. 31.\n\nThe [city's calendar](${calendar}) says parade participants should line up at Main Street School at 1:30 p.m. The parade starts at 2 p.m. on Main Street.\n\n[Merchant trick-or-treat](https://www.norwalkoh.com/city-calendar/2020/10/31/merchant-trick-or-treat) is listed from 2:15 to 3:30 p.m. at uptown businesses after the parade.\n\n[Neighborhood trick-or-treat](https://www.norwalkoh.com/city-calendar/2020/10/31/trick-or-treat) runs from 6 to 7:30 p.m. The city has not listed a full parade route or participating-business list on those pages. Check its calendar for updates before attending.`,
    },
  ],
  events: [],
  images: [
    { key: 'norwalk', filename: 'norwalk-west-main-street-2008.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG', download_url: 'https://upload.wikimedia.org/wikipedia/commons/archive/0/0d/20120402195507!Norwalk_Ohio.JPG', license: 'Public domain', license_url: 'https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG', credit: 'OHWiki / Wikimedia Commons / Public domain', alt: 'Brick storefronts and parked cars line West Main Street in downtown Norwalk.', caption: 'West Main Street in downtown Norwalk. File photo uploaded July 18, 2008; it does not show the 2026 Halloween parade.' },
    { key: 'pumpkins', filename: 'pumpkins-alabama-2016.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:Pumpkins_(48828549523).jpg', download_url: 'https://upload.wikimedia.org/wikipedia/commons/b/bb/Pumpkins_%2848828549523%29.jpg', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: 'Bruce Dupree / Alabama Extension / CC0 1.0', alt: 'Orange and white pumpkins sit on hay bales outside a farm market.', caption: 'Pumpkins in Alabama, photographed Sept. 19, 2016. Illustrative file photo; these are not the pumpkins hidden at Erie MetroParks.' },
  ],
};
function event(slug, title, summary, fields) {
  return { slug, title, summary, description: '', category: 'family', starts_on: '2026-10-31', start_time: null, end_time: null,
    ends_on: null, hours_note: '', venue: '', address: '', community: 'Norwalk', organizer: 'City of Norwalk', organizer_url: 'https://www.norwalkoh.com/', cost: 'Not listed; confirm with organizer', link: calendar, image: null, ...fields };
}
pack.events.push(
  event('norwalk-pet-n-pup-parade-october-17-2026', 'Norwalk Pet N Pup Parade', 'Registration starts at 1:30 p.m.; the Main Street parade starts at 2 p.m.', { starts_on: '2026-10-17', start_time: '14:00', end_time: '15:00', venue: 'Main Street Norwalk', address: '', link: 'https://www.norwalkoh.com/city-calendar/2024/9/7/pet-n-pup-parade', description: `The city lists registration at 1:30 p.m. and a 2 p.m. parade. Participation rules and fees are not listed. [City calendar](${calendar}).`, image: 'norwalk' }),
  event('norwalk-halloween-parade-2026', 'Norwalk Halloween parade', 'Line up at Main Street School at 1:30 p.m.; parade starts at 2 p.m.', { start_time: '14:00', end_time: null, venue: 'Main Street', link: 'https://www.norwalkoh.com/city-calendar/2021/10/30/halloween-parade', description: `Lineup is at Main Street School at 1:30 p.m. The parade begins at 2 p.m. The city's calendar block runs until 4 p.m.; it does not establish the parade's duration. [City schedule](${calendar}).`, image: 'norwalk' }),
  event('norwalk-merchant-trick-or-treat-2026', 'Norwalk merchant trick-or-treat', 'Uptown businesses offer trick-or-treat after the Halloween parade.', { start_time: '14:15', end_time: '15:30', venue: 'Uptown Main Street businesses', link: 'https://www.norwalkoh.com/city-calendar/2020/10/31/merchant-trick-or-treat', description: 'Separate from evening neighborhood trick-or-treat. [City listing](https://www.norwalkoh.com/city-calendar/2020/10/31/merchant-trick-or-treat).', image: 'norwalk' }),
  event('norwalk-citywide-trick-or-treat-2026', 'Norwalk neighborhood trick-or-treat', 'Evening trick-or-treat hours are 6 to 7:30 p.m.', { start_time: '18:00', end_time: '19:30', venue: 'City of Norwalk neighborhoods', link: 'https://www.norwalkoh.com/city-calendar/2020/10/31/trick-or-treat', description: 'Separate from uptown merchant trick-or-treat. [City listing](https://www.norwalkoh.com/city-calendar/2020/10/31/trick-or-treat).' }),
  event('chefs-garden-fall-fest-october-17-2026', "Fall Fest at The Chef's Garden", 'Local craft and food vendors, face painting and live music at the Farm Market.', { starts_on: '2026-10-17', start_time: '09:00', end_time: '15:00', venue: "The Chef's Garden Farm Market", address: '1517 Scheid Road', community: 'Huron', organizer: "The Chef's Garden", organizer_url: 'https://chefs-garden.com/', link: farm, description: `The organizer lists live music by Steve Brownell, face painting and local vendors. Admission and activity charges are not specified. [Organizer details](${farm}); [venue listing](https://business.greatersandusky.com/community-calendar/Details/fall-festival-at-the-chef-s-garden-farm-market-1745744).` }),
  event('hoffman-forest-walk-beneath-pines-october-14-2026', 'Walk Beneath the Pines', 'An all-ages guided walk at Hoffman Forest MetroPark; no registration required.', { starts_on: '2026-10-14', start_time: '14:00', end_time: '15:00', category: 'outdoors', venue: 'Hoffman Forest MetroPark', address: '5159 Huff Road', community: 'Berlin Heights', organizer: 'Erie MetroParks', organizer_url: 'https://eriemetroparks.org/', cost: 'Free park program', link: brochure, description: `Meet in the parking lot for a guided walk about white pine ecology and history. Walk-ins welcome. [October 2026 program brochure](${brochure}).` }),
  event('osborn-birds-coffee-october-15-2026', 'Birds & Coffee at Osborn MetroPark', 'Adult birdwatching program with loaner binoculars; walk-ins welcome.', { starts_on: '2026-10-15', start_time: '08:30', end_time: '10:00', category: 'outdoors', venue: 'Roger Johnson Nature Center, Atrium', address: '3910 Perkins Ave.', community: 'Huron', organizer: 'Erie MetroParks', organizer_url: 'https://eriemetroparks.org/', cost: 'Free park program', link: brochure, description: `Join naturalist Mike for birdwatching and a hot beverage. Intended for adults; no experience or registration required. Binoculars are available to borrow. [October 2026 program brochure](${brochure}).` }),
);
writeFileSync(dir + 'package.json', JSON.stringify(pack, null, 2) + '\n');
const sources = [
  ['norwalk-calendar', calendar], ['pumpkin-hunt', hunt], ['pumpkin-clue-1', 'https://eriemetroparks.org/wp-content/uploads/2026/10/Clue-1-scaled.jpg'], ['pumpkin-clue-2', 'https://eriemetroparks.org/wp-content/uploads/2026/10/Clue-2-scaled.jpg'], ['metroparks-october', brochure], ['farm-festival', farm],
  ...pack.images.map(p => [p.key + '-permission', p.source_url]),
];
const evidence = [];
for (const [name, url] of sources) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const type = response.headers.get('content-type');
  const ext = type.includes('pdf') ? '.pdf' : type.includes('image') ? '.jpg' : '.html';
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(dir + 'evidence/' + name + ext, bytes);
  evidence.push({ url, file: name + ext, fetched_at: new Date().toISOString(), bytes: bytes.length });
}
for (const photo of pack.images) {
  const response = await fetch(photo.download_url);
  if (!response.ok) throw new Error(`${photo.download_url}: ${response.status}`);
  writeFileSync(dir + 'images/' + photo.filename, Buffer.from(await response.arrayBuffer()));
}
writeFileSync(dir + 'evidence/sources.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ directory: dir, articles: pack.articles.length, events: pack.events.length, images: pack.images.length }));
