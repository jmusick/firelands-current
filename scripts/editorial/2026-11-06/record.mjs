import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-11-06');
const read = name => JSON.parse(readFileSync(dir + name, 'utf8'));
const packet = read('research.json');
const verified = read('production-verification.json');
const local = read('evidence/local-http-verification.json');
assert(verified.sections_match_local && verified.live.length === 4);
assert(verified.facebook.length === 3 && verified.facebook.every(p => p.status === 'pending' && !p.last_error && p.attempts === 0));
const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(new Date(verified.checked_at));
const links = packet.stories.map(s => `- [${s.headline}](https://firelandscurrent.com/news/${s.slug})`).join('\n');
const record = `# Nov. 6 publication record

Verified ${time} Eastern. Opening publisher request authorized local-dev import, production sync and Facebook queuing.

## Published stories

${links}

Updated [Sandusky Harbor dredging finishes; 100,000 cubic yards placed near shore](https://firelandscurrent.com/news/${packet.updates[0].slug}) with the Army Corps' Nov. 5 completion report. Original publication date, discussion, existing Facebook ledger and uncropped licensed 2020 body photo preserved. No duplicate post queued.

## Verified outcome

- Local dev: three stories, one update, four public pages checked; JD account-linked bylines, discussions, summaries and social metadata verified. Existing unrelated rows unchanged. Browser reviewed the news list and rendered Cedar Point brief.
- Production: ${verified.counts.stories} stories, ${verified.counts.events} events, ${verified.counts.discussions} discussions and ${verified.counts.images} images. Three story and discussion rows added, one story updated, seven content-audit and three Facebook queue-audit entries written.
- All published-news section counts match local dev. Local event count is ${local.counts.events}; production had 108 before and after this packet. The pre-existing calendar difference was outside this story-only sync.
- Facebook: three entries pending, zero attempts, no errors at verification. Queue placement is confirmed; completed Facebook publication is not claimed. Last scheduled publisher run succeeded with no error.
- No calendar imports, image uploads, feature changes, migrations, commits, pushes or Worker deployment.
- Packet checker passed with no warnings. Type check passed with zero errors/warnings and two pre-existing unused-variable hints in test-audit.mjs. Production build passed; Wrangler reported a sandbox log-file write restriction. Local import initially stopped at the sandboxed registry write before database work; journal check confirmed no import had begun, and authorized elevated retry succeeded.
- Local dev is running at http://127.0.0.1:4321/news, started after type check and build.

## Sources and held leads

Cedar Point and Army pages preserved as HTML/text. Ohio agency pages returned HTTP 404 to scripted clients but rendered in the signed-in browser; verified source passages preserved in evidence/browser-source-excerpts.txt. Two useful source entries added to docs/news-sources.md. No source photo rights inferred. Turkey brief reports regular-season dates only; malformed youth year omitted, bass-rule details held for Lake Erie exception checks.

## Recovery evidence

Initial remote preflight returned Cloudflare code 7403 before any production write. Read-only Wrangler identity and D1 information checks succeeded, followed by the full preflight. No credential or permission changes made.

Exact SQL, write-intent journals, content hashes, local and production baselines and live verification remain beside this record. Do not rerun preparation or import after a journal exists; inspect the current rows and journal first.

Research: [review packet](review.md), [structured copy](research.json), [production verification](production-verification.json), [source fetches](evidence/sources-sweep.json), [browser evidence](evidence/browser-source-excerpts.txt).
`;
writeFileSync(dir + 'production-publication.md', record);
const reviewPath = dir + 'review.md';
const review = readFileSync(reviewPath, 'utf8');
if (!review.startsWith('# Publication completed')) writeFileSync(reviewPath, `# Publication completed\n\nThree new stories and the harbor completion update are live locally and in production. Three Facebook entries verified pending with no errors at ${time} Eastern. [Live links and publication record](production-publication.md).\n\n` + review);
console.log(JSON.stringify({ recorded: true, stories: 3, updates: 1, queued: 3, checked_at: verified.checked_at }));
