import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-10-26');
assert(!existsSync(dir + 'local-import.json') && !existsSync(dir + 'local-import-pending.json'), 'Inspect the import journal before changing reviewed copy');
const packet = JSON.parse(readFileSync(dir + 'research.json', 'utf8'));
assert.deepEqual(packet.stories.map(story => story.key), ['charter', 'pickup', 'housing']);
if (!existsSync(dir + 'research-before-publication.json')) writeFileSync(dir + 'research-before-publication.json', readFileSync(dir + 'research.json'));
const housing = packet.stories.find(story => story.key === 'housing');
housing.body = housing.body.replace('A housing program in Clyde is seeking buyers for six planned homes', 'Welcome Home Clyde is seeking buyers for six planned homes');
housing.notes += ' Final Newsroom Edit: named the program in the lede; facts and scope unchanged. No unresolved Check flags.';
for (const story of packet.stories) {
  const path = dir + 'drafts/' + story.key + '.md';
  let draft = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const oldBody = draft.split('# Story\n\n')[1].split('\n\n# Notes')[0];
  draft = draft.replace(oldBody, story.body);
  draft += '\n# Final prepublication Edit and Check\n\n';
  draft += story.key === 'housing' ? 'Named Welcome Home Clyde in the lede. ' : 'Copy retained after final source comparison. ';
  draft += 'The refreshed primary page agrees with the saved facts. No invented dates, prices, reactions or quotations. Primary links, byline instructions, image rights, lede length, attribution and house style checked.\n\nFlags: NONE\n\nCheck: NONE\n';
  writeFileSync(path, draft);
}
writeFileSync(dir + 'research.json', JSON.stringify(packet, null, 2) + '\n');
writeFileSync(dir + 'evidence/prepublication-newsroom-check.md', '# Final Newsroom fact ledger and Check\n\n' +
  '- Charter: Clyde; four proposed charter changes; Nov. 3, 2026; compensation, remote meetings, publication and civil service. Primary city guide and all four packets support the limited proposal preview. No legal-effects assessment, savings claim, voting-hour claim or invented reaction.\n' +
  '- Pickup: Norwalk households; Nov. 2-6, 2026; regular trash day; three items/nine bags, 33-gallon maximum, equivalent combinations, no added charge; household-only exclusions and refrigerant tags. City occurrence page supports every practical detail.\n' +
  '- Housing: Welcome Home Clyde/Community Building Partners; six planned sites; ongoing buyer call, no deadline/completion date; predevelopment; at least $205,000 mortgage preapproval, not verified sale price; 120% area median income limit, $105,225 for four people; residence/training/resale conditions; verified program contact. Current organizer page supports each stated condition.\n' +
  '- No direct quotations used. No accusation, contested claim or personal financial recommendation. No unverified photograph used.\n\nFinal Check: NONE\n');
console.log('Three story drafts finalized with Newsroom; original packet preserved.');
