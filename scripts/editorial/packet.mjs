// One tool for a day's reviewed packet (issue #108). It replaces copying a dated import.mjs / sync.mjs pair.
// The packet is the manifest `packet.json` in the day's project-library folder; see docs/editorial-tools.md.
//
//   node scripts/editorial/packet.mjs --date YYYY-MM-DD <mode> [options]
//
// Local modes (the local database only):
//   --apply-local    import the packet once, journaled, then run --verify-local
//   --verify-local   rows, counts, untouched existing rows, held Facebook rows, photo checksums
//   --verify-http    --verify-local plus every page, calendar export and photo on the running dev server
// Production modes (run only on the owner's go-ahead, and only with --production):
//   --prepare        read-only baseline of the target, then the reviewed SQL and its hash
//   --publish        upload photos, write the content, verify the live pages; Facebook stays in review
//   --queue          release the reviewed Facebook deliveries, after verifying again
//   --verify         final counts, sections, deliveries and live pages
//
// Options:
//   --persist-to DIR       Wrangler state directory of the local database (default .wrangler/state)
//   --journal-dir DIR      write journals and evidence here instead of the packet folder (rehearsals)
//   --origin URL           dev server for --verify-http (default http://127.0.0.1:4321)
//   --production           run a production mode against https://firelandscurrent.com
//   --rehearsal-db DIR     run a production mode against a second throwaway local copy instead
//   --rehearsal-origin URL dev server serving that copy, for the live-page checks
//   --ignore-window        skip the budget-date window; only with --persist-to or --rehearsal-db, never with --production
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { openJournal } from './lib/journal.mjs';
import { assertLocalOrigin } from './lib/http.mjs';
import { applyLocal, verifyHttp, verifyLocal } from './lib/local-modes.mjs';
import { DEFAULT_STATE, openLocal } from './lib/local.mjs';
import { loadManifest } from './lib/manifest.mjs';
import { prepare, publish, queue, verify } from './lib/production-modes.mjs';
import { productionTarget, rehearsalTarget } from './lib/target.mjs';

const LOCAL_MODES = ['--apply-local', '--verify-local', '--verify-http'];
const PRODUCTION_MODES = ['--prepare', '--publish', '--queue', '--verify'];
const VALUE_OPTIONS = ['--date', '--persist-to', '--journal-dir', '--origin', '--rehearsal-db', '--rehearsal-origin'];
const FLAG_OPTIONS = ['--production', '--ignore-window'];

function parse(argv) {
  const modes = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ([...LOCAL_MODES, ...PRODUCTION_MODES].includes(arg)) modes.push(arg);
    else if (VALUE_OPTIONS.includes(arg)) { assert(argv[i + 1] && !argv[i + 1].startsWith('--'), arg + ' needs a value'); assert(!(arg in options), arg + ' given twice'); options[arg] = argv[++i]; }
    else if (FLAG_OPTIONS.includes(arg)) options[arg] = true;
    else assert.fail('Unknown argument: ' + arg);
  }
  assert.equal(modes.length, 1, 'Give exactly one mode: ' + [...LOCAL_MODES, ...PRODUCTION_MODES].join(', '));
  assert(/^\d{4}-\d{2}-\d{2}$/.test(options['--date'] ?? ''), '--date YYYY-MM-DD is required');
  return { mode: modes[0], options };
}

function targetFor(mode, options, stateDir) {
  if (!PRODUCTION_MODES.includes(mode)) {
    assert(!options['--production'] && !options['--rehearsal-db'] && !options['--rehearsal-origin'], mode + ' is a local mode; --production and --rehearsal-* apply to production modes only');
    return null;
  }
  const production = options['--production'] === true, rehearsal = options['--rehearsal-db'];
  assert(production !== Boolean(rehearsal), `${mode} needs exactly one of --production (the real site) or --rehearsal-db (a throwaway copy)`);
  if (production) {
    assert(!options['--journal-dir'] && !options['--persist-to'] && !options['--ignore-window'] && !options['--rehearsal-origin'], '--production runs use the real project-library journals and the working local database only');
    console.error('PRODUCTION: ' + mode + ' will read' + (['--publish', '--queue'].includes(mode) ? ' and WRITE' : '') + ' the live D1 database. Run it only with the owner\'s go-ahead.');
    return productionTarget();
  }
  assert(options['--rehearsal-origin'], '--rehearsal-db also needs --rehearsal-origin');
  return rehearsalTarget({ stateDir: rehearsal, origin: options['--rehearsal-origin'], localStateDir: stateDir });
}

const { mode, options } = parse(process.argv.slice(2));
const date = options['--date'];
const stateDir = resolve(options['--persist-to'] ?? DEFAULT_STATE);
if (options['--ignore-window']) {
  assert(options['--persist-to'] || options['--rehearsal-db'], '--ignore-window needs --persist-to or --rehearsal-db');
  if (LOCAL_MODES.includes(mode)) assert.notEqual(stateDir, resolve(DEFAULT_STATE), '--ignore-window requires a throwaway database');
}
const target = targetFor(mode, options, stateDir);
const journal = openJournal(date, options['--journal-dir']);
const loaded = loadManifest(journal.packetDir, date);
const runOptions = { ignoreWindow: options['--ignore-window'] === true };
const needsLocal = LOCAL_MODES.includes(mode) || mode === '--prepare';
const local = needsLocal ? await openLocal(stateDir) : null;
try {
  const args = { loaded, journal, local, target, options: runOptions };
  const result = mode === '--apply-local' ? await applyLocal(args)
    : mode === '--verify-local' ? await verifyLocal(args)
    : mode === '--verify-http' ? await verifyHttp({ ...args, origin: assertLocalOrigin(options['--origin'] ?? 'http://127.0.0.1:4321') })
    : mode === '--prepare' ? await prepare(args)
    : mode === '--publish' ? await publish(args)
    : mode === '--queue' ? await queue(args)
    : await verify(args);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await local?.dispose();
}
