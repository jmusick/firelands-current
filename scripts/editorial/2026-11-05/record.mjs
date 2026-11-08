import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-11-05');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const packet = read('research.json');
const verified = read('production-verification.json');
const local = read('evidence/local-http-verification.json');
assert(verified.sections_match_local && verified.live.length === 4);
assert(verified.facebook.length === 3 && verified.facebook.every(p => ['pending', 'posting', 'posted'].includes(p.status) && !p.last_error));
const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(new Date(verified.checked_at));
const stories = packet.stories.map(s => `- [${s.headline}](https://firelandscurrent.com/news/${s.slug})`).join('\n');
const sections = verified.sections_match_local ? 'All published-news section counts match local dev.' : '';
const record = `# Nov. 5 publication record

Verified ${time} Eastern. Opening publisher request authorized local-dev import, production sync and Facebook queuing.

## Published stories

${stories}

Updated [Sandusky school levy falls short in unofficial results](https://firelandscurrent.com/news/${packet.updates[0].slug}) with the district's Nov. 4 response. Original publication date, discussion and Facebook ledger preserved; no duplicate post queued.

## Verified outcome

- Local dev: three stories, one update, four public pages checked; bylines link to JD, discussion links work, social metadata and masthead fallback present. Existing unrelated rows verified unchanged.
- Production: 123 stories, 108 events, 236 discussions, 56 images. Three story rows and discussions added, one story updated, seven content-audit entries and three queue-audit entries written.
- ${sections} Local event count is ${local.counts.events}; production had 108 before and after this packet. That pre-existing calendar difference was not changed by this story-only sync.
- Facebook: three entries verified pending, zero attempts, no last_error. This records queue placement, not completed posting. The publisher's last scheduled run succeeded without error.
- No image uploads, feature changes, migrations, commits, pushes or Worker deployment.
- Packet checker: no problems. Type check: zero errors/warnings, two existing unused-variable hints in test-audit.mjs. Production build completed; sandbox blocked only Wrangler's external log-file write. The local dev server was started after checks at http://127.0.0.1:4321/news.

## Recovery evidence

Initial production preflight returned Cloudflare code 7403 before any write. Wrangler identity and database-info checks then succeeded, and the next preflight passed. No credential or permission change was made.

Local and production write-intent journals, exact prepared SQL, copy hashes and before/after checks are retained beside this record. Do not rerun prepare.mjs or an import after a journal exists. Inspect the journals and current rows first.

Research: [review packet](review.md), [structured copy](research.json), [live verification](production-verification.json), [source fetch results](evidence/sources-sweep.json), [ODNR browser evidence](evidence/odnr-browser-excerpts.txt).
`;
writeFileSync(dir + 'production-publication.md', record);
const reviewPath = dir + 'review.md';
const review = readFileSync(reviewPath, 'utf8');
if (!review.startsWith('# Publication completed')) writeFileSync(reviewPath, `# Publication completed\n\nThree new stories and the levy response update are live locally and in production. Three Facebook entries verified pending with no errors at ${time} Eastern. [Live links and publication record](production-publication.md).\n\n` + review);
console.log(JSON.stringify({ recorded: true, stories: 3, updates: 1, queued: 3, checked_at: verified.checked_at }));
