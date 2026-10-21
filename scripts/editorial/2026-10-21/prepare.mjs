import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-21');
assert(process.argv.length === 2);
assert(!existsSync(dir + 'local-import-pending.json'), 'Import already prepared; inspect journal before editing');
const research = JSON.parse(readFileSync(dir + 'research.json', 'utf8'));
if (!existsSync(dir + 'research-budget.json')) writeFileSync(dir + 'research-budget.json', JSON.stringify(research, null, 2) + '\n');
const library = research.stories.find(story => story.key === 'ritter-closure');
library.body = library.body.replace('The library\'s [regular hours]', 'The library\'s posted [weekly hours]').replace(' Those are its posted weekly hours; the closure notice does not give a separate reopening announcement.', '');
const brush = research.stories.find(story => story.key === 'norwalk-brush');
brush.body = brush.body.replace('collected. Residents with', 'collected.\n\nResidents with').replace('Construction and remodeling debris are excluded.', '\n\nConstruction and remodeling debris are excluded.').replace('pickup-truck load', 'pickup truck load');
for (const story of research.stories) {
  const path = dir + `drafts/${story.key}.md`;
  let draft = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  draft = draft.replace(/(## Story\n\n)[\s\S]*?(\n\n## Notes)/, (_, start, end) => start + story.body + end);
  draft = draft.replace("Type: brief. Byline on later import: JD's account, per repository policy.", "Type: brief. Local byline: JD's account, per repository policy.");
  writeFileSync(path, draft);
}

const descriptions = {
  'coastal-open-house': 'Showroom tours and light refreshments are planned from 9 a.m. to 5 p.m. The Greater Sandusky Partnership calendar summary says the ribbon cutting is at 10 a.m.; its detailed listing says 11 a.m. Call the business at 419-504-6476 to confirm the ceremony or ask about accommodations.',
  'pathway-mixer': 'The Greater Sandusky Partnership will host a discussion of the Sandusky Bay Pathway, including completed work and plans for future connections. The mixer runs from 5:30 to 7:30 p.m., with the program beginning about 6 p.m.\n\nZaria Johnson is scheduled to moderate a panel with Jeff Kerr, Megan Stookey and Jannah Wilson. Members can register for complimentary tickets through the organizer. Nonmembers should contact Patrick Shepherd at patrick@greatersandusky.com or 419-273-6086 about access. Light refreshments are planned.',
  'norwalk-bza': 'The Norwalk Board of Zoning Appeals is scheduled to meet at 6 p.m. at Municipal Court. Contact City Hall at 419-663-6700 for agenda information or accessibility questions.',
  'ritter-printing': 'Teens can create or select a design, print it and heat-transfer it to a tote bag to take home. The program is in person in the makerspace. The library lists its audience as teens ages 12–18; the description says ages 12 and up. Contact the library to confirm eligibility for anyone outside the teen age range.\n\nRegistration is required through the event page. Call 440-967-3798 about accommodations.',
  'clean-marinas': 'The Ohio Clean Marinas Program will cover program updates, marina management practices and certification or recertification. Marinas, boat and yacht clubs and clean-boating partners are welcome.\n\nUse the [workshop registration form](https://ohioseagrant.osu.edu/outsourced/forms/view.php?id=318950) to sign up. Questions and accommodation inquiries may be sent to ohiocleanmarinas@osu.edu.',
  'wetland-webinar': 'Bowling Green State University researchers Helen Michaels and Kevin McCluney are scheduled to discuss research on 12 common Ohio wetland species and how the plants influence nutrient uptake, storage and sediment trapping.\n\nRegister through the organizer\'s event page. Contact organizer Jill Jentes Banicki through that page for captioning or other access questions.',
};
for (const event of research.events) event.description = descriptions[event.key];
const mixer = research.events.find(event => event.key === 'pathway-mixer');
mixer.category = 'community';
// hours_note replaces the actual time range in cards; keep the program time in the description.
mixer.hours_note = '';
const meeting = research.events.find(event => event.key === 'norwalk-bza');
meeting.cost = '';
meeting.summary = 'Norwalk zoning appeals board members are scheduled to meet at Municipal Court.';
writeFileSync(dir + 'research.json', JSON.stringify(research, null, 2) + '\n');
writeFileSync(dir + 'local-newsroom-check.md', `# Newsroom final local edit — Oct. 21, 2026

## Notes

Four article drafts retain their three headline choices, source links and final copy. All six event descriptions were edited for readers. Editor-only comments about calendar blocks, hidden templates and whether claims were asserted remain in research notes rather than public descriptions. The showroom ceremony discrepancy and teen eligibility wording remain explicit.

Ritter's weekly hours are labeled as posted hours; the redundant sentence about a separate reopening announcement was removed. Norwalk's long paragraphs were split and pickup truck wording simplified. No fact, quoted statement, start time, fee or eligibility requirement was invented. The GSP mixer is categorized Community because it is a member networking program; its 5:30–7:30 p.m. range remains visible on cards and its approximately 6 p.m. program start is in the description.

Article image selections: one existing public-domain Norwalk photo, no uncleared images. Feature changes and social delivery are outside the authorized local import.

## Flags

NONE

## Check

Accuracy, ledes, structure, attribution, fairness, voice and AP/house style checked against the saved primary evidence. Names, dates, numbers and access terms match the packet. No blocking gaps or invented reactions remain. The conflicting ceremony times are sourced and disclosed, not resolved by assumption.
`);
console.log('Final copy saved: four articles and six calendar descriptions.');
