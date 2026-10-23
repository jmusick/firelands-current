import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-22');
assert.equal(process.argv.length, 2);
assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect import journal before changing copy');
const research = JSON.parse(readFileSync(dir + 'research.json', 'utf8'));
assert.equal(research.date, '2026-10-22');
if (!existsSync(dir + 'research-budget.json')) writeFileSync(dir + 'research-budget.json', JSON.stringify(research, null, 2) + '\n');
research.scope = 'Final newsroom copy for editor-authorized local dev import; no production sync, uploads, featuring or social delivery';
const cemetery = research.stories.find(story => story.key === 'cemetery-cleanup');
cemetery.body = cemetery.body.replace(/\n\nA separate All Souls Day Mass[\s\S]*?(?=\n\nFor cleanup)/, '');
cemetery.body = cemetery.body.replace('For cleanup or cemetery questions, call 419-625-2673.', 'For cleanup or cemetery questions, call cemetery administrator JoAnn Didion at 419-625-2673.');
const sensory = research.stories.find(story => story.key === 'stone-sensory');
sensory.body = sensory.body.replace('The announcement does not describe step-free access to the third-floor rooms. Visitors planning to use the accommodations can ask Ohio Sea Grant business coordinator Erin Monaco about access and arrangements at monaco.25@osu.edu.', 'For questions about the sensory accommodations, contact Erin Monaco, Ohio Sea Grant business coordinator, at monaco.25@osu.edu. Visitors who need step-free access should ask about arrangements for the third-floor rooms.');
const preschool = research.stories.find(story => story.key === 'preschool-screening');
preschool.body = preschool.body.replace('Port Clinton City Schools will offer', 'The Port Clinton City School District will offer');
const update = research.updates[0];
update.proposed_copy = `*Updated Oct. 22 with the opening of public voting.*

Sandusky has opened People's Choice voting in its Haunt the House Halloween decorating contest, with voting continuing through Oct. 29.

Readers can reach the ballot through the [city's contest link](https://www.cityofsandusky.com/hauntedhouse). The [city's Wednesday announcement](https://x.com/cityofsandusky/status/2113009278114046046) confirms the voting deadline.

The contest is presented with the Greater Sandusky Partnership. The entry period has ended, and the contest is now in its public-voting phase.

The city has not specified a closing hour in its announcement.`;
const descriptions = {
  'sandusky-band': 'The Sandusky marching band gym concert is scheduled for 6:45 to 8:15 p.m. Monday in the Sandusky High School main gym. For admission or accessibility questions, call the district at 419-626-6940.',
  'magruder-wellness': `Magruder Hospital will host a free women's health and wellness evening from 5 to 7 p.m. Monday. No registration or RSVP is required. Check in through the main entrance.

The hospital lists free chair massages, refreshments, gift-basket raffles and giveaways. Ten-minute presentations will cover stretching and lymph drainage, mental health, stress and hormones, cancer resources, and nutrition and quality of life.

Representatives will be available from Dermatology Partners, Magruder Nutrition and Vein & Body Specialists at Magruder, among others. For accessibility questions, call 419-734-3131.`,
  'all-souls': `An All Souls Day Mass is scheduled for 9 a.m. Nov. 2 in the Calvary Cemetery mausoleum, followed by an open house with coffee and doughnuts.

Cemetery administrator JoAnn Didion and volunteers will answer questions and demonstrate the Cemify online cemetery database. For attendance or accessibility questions, call 419-625-2673.`,
  'cemetery-volunteers': 'The Catholic Cemeteries of Sandusky need volunteers for fall cleanup Nov. 5. Meet at 9 a.m. in front of the Calvary Cemetery office. For information about volunteering, equipment or accessibility, call JoAnn Didion at 419-625-2673.',
  'preschool': `The Port Clinton City School District offers free developmental screenings for district residents ages 3 to 5. Appointments begin at 8:30 a.m. Nov. 13 and take about an hour.

Schedule by Nov. 11 with Sarah Bazar at 419-734-2815. Children will be evaluated in vision, hearing, motor development, communication and concept development.

Use the main entrance off the parking lot at the back of Bataan Memorial Primary Elementary School. Ask about accessibility arrangements when scheduling.`,
};
for (const event of research.events) {
  if (event.status !== 'ready') continue;
  assert(descriptions[event.key]);
  event.description = descriptions[event.key];
  if (['sandusky-band', 'all-souls', 'cemetery-volunteers'].includes(event.key)) event.cost = '';
}
for (const story of research.stories) {
  const path = dir + `drafts/${story.key}.md`;
  let draft = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  draft = draft.replace(/(## Story\n\n)[\s\S]*?(\n\n## Notes)/, (_, start, end) => start + story.body + end);
  draft = draft.replace('Byline for later import: JD, account linked after confirming the author ID. Research only; no database entry made.', 'Final local copy. Byline: JD, account ID confirmed during import. The editor authorized local dev entry in this conversation.');
  writeFileSync(path, draft);
}
writeFileSync(dir + 'research.json', JSON.stringify(research, null, 2) + '\n');
writeFileSync(dir + 'drafts/haunt-voting-update.md', `# ${update.headline}

## Headlines

1. ${update.headline}
2. Sandusky opens People's Choice voting for Halloween decorations
3. Haunt the House voting continues through Oct. 29

## Story

${update.proposed_copy}

## Notes

Updates the existing story at its original URL and keeps its original publication date. The dated update note describes new information, not a correction. No count of permitted choices is stated because ballot instructions differ. No vote, closing hour or winner inferred. Existing byline and discussion are preserved.

## Flags

NONE

## Newsroom Check mode

NONE
`);
writeFileSync(dir + 'local-newsroom-check.md', `# Newsroom final local edit, Oct. 22, 2026

## Notes

Three briefs and the existing voting story were edited in Write mode and checked against the primary evidence gathered earlier today. Each draft has three headline choices, final copy, notes and flags. Ledes are within 35 words. No names, figures, dates, quotes or reactions were invented.

The cemetery story now focuses on the cleanup deadline and volunteers; the Mass remains a separate calendar listing. The screening story uses the district's formal name and the flyer-confirmed 8:30 a.m. time. Stone Lab ends with the accommodations contact and a practical instruction for visitors who need step-free access, without promising an elevator or public tour date.

The voting story has a dated update note and a new lede, headline and summary. The original URL and publication date remain. The number of permitted selections is omitted because the form's instructions conflict. This is a new-information update, not a correction.

Five ready calendar descriptions were edited for readers. Unknown prices are blank. Research comments about missing details remain in notes rather than public descriptions. Tonight's Port Clinton concert remains needs-check and is excluded from import. No uncleared images are used.

## Flags

NONE

## Check

Accuracy, ledes, paragraph order, attribution, fairness, voice and AP/house style checked. No blocking placeholders remain in imported copy. Source links, date and time boundaries, residency requirements and appointment terms are preserved.
`);
console.log('Final newsroom copy saved: 3 briefs, 1 update and 5 ready events; 1 event held.');
