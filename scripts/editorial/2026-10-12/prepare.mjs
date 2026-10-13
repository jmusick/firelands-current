import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-12');
if (existsSync(dir + 'import.json')) throw new Error('Preserve the imported package.');
mkdirSync(dir + 'evidence', { recursive: true });
mkdirSync(dir + 'images', { recursive: true });
const gas = 'https://huroncountyohio.com/huroncountyawards2026/';
const screening = 'https://www.firelands.com/classes-events/search-results-detail/?eventId=db2ffa16-0c18-f111-93dc-de5a012b9d1a';
const lunch = 'https://www.firelands.com/classes-events/search-results-detail/?eventId=24e7f230-fac3-f011-b412-faa02903481b';
const blood = 'https://www.firelands.com/classes-events/search-results-detail/?eventId=8caaee38-4dbb-f011-b412-faa02903481b';
const workshop = 'https://eccflccc26october.rsvpify.com/';
const foundation = 'https://eriefoundation.org/';
const pack = {
  date: '2026-10-12',
  articles: [
    {
      slug: 'norwalk-natural-gas-improvement-project-october-2026',
      headline: 'Huron County partnership outlines $12 million natural-gas project',
      summary: 'The organization says a groundbreaking later this month will provide more details about the project developed with Norwalk and regional partners.',
      section: 'business', community: 'Norwalk', image: 'norwalk',
      body: `Huron County Growth Partnership says it has helped develop a $12 million natural-gas improvement project with Norwalk and regional economic development agencies, with more details expected at an October groundbreaking.\n\nExecutive Director Sarah Ross described the work in the [partnership's Oct. 9 report](${gas}) on its annual gathering in Monroeville. The organization says the project took shape over two years with partners including the city, Team NEO and JobsOhio.\n\nThe report does not identify the utility, construction location, funding breakdown or completion schedule. It says a groundbreaking later this month will provide more information, but gives no date.\n\nThe same report says a spring business-attraction trip to Italy and Switzerland produced six qualified leads from 15 meetings. Those are prospects, not announced investments or confirmed jobs.`,
    },
    {
      slug: 'firelands-breast-screening-october-17-2026',
      headline: 'Firelands to offer breast screenings Saturday for uninsured and underinsured patients',
      summary: 'Registration is required for the Oct. 17 event in Sandusky. Eligible insurance will be billed, but patients will not owe the remaining balance.',
      section: 'local', community: 'Sandusky', image: 'mammography',
      body: `Firelands Health will offer breast screenings Saturday, Oct. 17, in Sandusky for uninsured or underinsured patients, including those with high insurance deductibles.\n\nThe [event listing](${screening}) gives hours of 9 a.m. to noon at the Firelands Center for Breast Care, 703 Tyler St., Suite 152. Registration is required at 419-557-7840.\n\nThe screening includes a clinical breast exam, education and a mammogram if a physician determines one is indicated.\n\nFirelands says eligible insurance will be billed, but patients will not be billed for a remaining balance. It advises eligible applicants to apply for the Breast/Cervical Cancer Program before screening. Call 800-929-6626 to check coverage eligibility. A financial counselor may contact applicants beforehand.`,
    },
    {
      slug: 'erie-foundation-nonprofit-ai-workshop-october-21-2026',
      headline: 'Erie County foundation to host free AI workshop for nonprofits',
      summary: 'Lorain County Community College presenter Matt Poyle will lead the Oct. 21 program in Sandusky.',
      section: 'community', community: 'Sandusky', image: 'sandusky',
      body: `Erie County Community Foundation will host a free workshop Oct. 21 in Sandusky about what recent developments in artificial intelligence mean for nonprofit organizations.\n\nMatt Poyle of Lorain County Community College will present “AI for Community Impact,” according to the [organizer's registration page](${workshop}). The program starts at 11:30 a.m.\n\nThe foundation promoted the program in an [Oct. 6 post on X](https://x.com/ErieCCF/status/2107461313685602734). Registration is available through the event page; questions can be sent to heidis@eriefoundation.org.\n\nThe [foundation](${foundation}) lists its address as 135 E. Washington Row. The announcement does not give an end time, registration deadline or detailed agenda.`,
    },
  ],
  events: [],
  images: [
    { key: 'norwalk', existing_id: '733286ca-e923-4c65-9952-8cac1a5ce602', source_url: 'https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG', license: 'Public domain', license_url: 'https://commons.wikimedia.org/wiki/File:Norwalk_Ohio.JPG', credit: 'OHWiki / Wikimedia Commons / Public domain' },
    { key: 'sandusky', existing_id: '45a371b4-c867-4dcd-a7e3-4293695b5415', source_url: 'https://commons.wikimedia.org/wiki/File:Sandusky,_Ohio_-_20201212_-_02_-_West_Water_Street.jpg', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', credit: 'Andre Carrotflower / Wikimedia Commons / CC BY-SA 4.0' },
    { key: 'mammography', filename: 'mammography-machine-nci-1991.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:Mammography_machine.jpg', download_url: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Mammography_machine.jpg', license: 'Public domain', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/', credit: 'Bill Branson / National Cancer Institute / Public domain', alt: 'An orange and white mammography machine stands beside a wall-mounted control panel.', caption: 'A mammography machine photographed in January 1991. National Cancer Institute file photo; this is not equipment at Firelands or a photograph of the Oct. 17 event.' },
  ],
};
function event(slug, title, summary, fields) {
  return { slug, title, summary, description: '', category: 'community', starts_on: '2026-10-17', start_time: null, end_time: null,
    ends_on: null, hours_note: '', venue: '', address: '', community: 'Sandusky', organizer: 'Firelands Health', organizer_url: 'https://www.firelands.com/', cost: '', link: '', image: null, ...fields };
}
pack.events.push(
  event('firelands-breast-screening-october-17-2026', 'Firelands breast screening', 'For uninsured or underinsured patients; call 419-557-7840 to register.', { start_time: '09:00', end_time: '12:00', venue: 'Firelands Center for Breast Care', address: '703 Tyler St., Suite 152', cost: 'Eligible insurance billed; no remaining balance billed to patients', link: screening, image: 'mammography', description: `Includes a clinical exam and a mammogram if indicated. Check Breast/Cervical Cancer Program eligibility at 800-929-6626. [Organizer details](${screening}).` }),
  event('bellevue-mature-audience-luncheon-october-15-2026', 'Bellevue Mature Audience Luncheon', 'Lunch and an educational program for adults 55 and older; reservations required.', { starts_on: '2026-10-15', start_time: '11:30', end_time: '13:00', category: 'classes', venue: 'Bellevue Society for the Arts', address: '205 Maple St.', community: 'Bellevue', organizer: 'The Bellevue Hospital', cost: '$5 for lunch', link: lunch, description: `Reserve by calling 419-483-4040, ext. 4319. The listing does not identify the speaker or topic. [Hospital listing](${lunch}).` }),
  event('erie-foundation-ai-community-impact-october-21-2026', 'AI for Community Impact nonprofit workshop', 'A free program with Lorain County Community College presenter Matt Poyle.', { starts_on: '2026-10-21', start_time: '11:30', category: 'classes', venue: 'Erie County Community Foundation', address: '135 E. Washington Row', organizer: 'Erie County Community Foundation and Lorain County Community College', organizer_url: foundation, cost: 'Free', link: workshop, description: `Register through the [organizer's event page](${workshop}). Questions: heidis@eriefoundation.org. End time is not announced. The [foundation website](${foundation}) supplies the venue address.` }),
  event('firelands-red-cross-blood-drive-october-23-2026', 'American Red Cross blood drive at Firelands', 'A blood drive at Firelands Regional Medical Center South Campus.', { starts_on: '2026-10-23', start_time: '11:00', end_time: '17:00', venue: 'Firelands Regional Medical Center South Campus', address: '1912 Hayes Ave.', organizer: 'American Red Cross', organizer_url: 'https://www.redcrossblood.org/', cost: 'No admission charge listed', link: blood, description: `Firelands lists registration as not required and also links to appointment scheduling at [Red Cross Blood](https://www.redcrossblood.org/). Call 800-733-2767 to schedule or check donation requirements. [Hospital listing](${blood}).` }),
);
writeFileSync(dir + 'package.json', JSON.stringify(pack, null, 2) + '\n');
for (const article of pack.articles) writeFileSync(dir + article.slug + '.md', `# ${article.headline}\n\nBy JD\n\n${article.summary}\n\n${article.body}\n`);
const sources = [['gas-project', gas], ['screening', screening], ['luncheon', lunch], ['blood-drive', blood], ['foundation', foundation], ...pack.images.map(p => [p.key + '-permission', p.source_url])];
const evidence = [];
for (const [name, url] of sources) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(dir + 'evidence/' + name + '.html', bytes);
  evidence.push({ url, file: name + '.html', fetched_at: new Date().toISOString(), bytes: bytes.length });
}
for (const photo of pack.images.filter(p => p.download_url)) {
  const response = await fetch(photo.download_url);
  if (!response.ok) throw new Error(`${photo.download_url}: ${response.status}`);
  writeFileSync(dir + 'images/' + photo.filename, Buffer.from(await response.arrayBuffer()));
}
writeFileSync(dir + 'evidence/sources.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ directory: dir, articles: pack.articles.length, events: pack.events.length, new_images: 1, reused_images: 2 }));
