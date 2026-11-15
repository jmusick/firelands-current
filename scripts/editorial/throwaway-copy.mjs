// Make a throwaway local copy of the database and media bucket for rehearsing a packet
// (docs/editorial-tools.md, "Rehearsing on a throwaway copy"). It uses the same export and
// restore order as scripts/restore-drill.mjs:
//
//   node scripts/editorial/throwaway-copy.mjs --from <state directory> --to <new persist directory>
//
// --from is a Wrangler state directory (for example C:\...\firelands-current\.wrangler\state),
// which is only ever read: it is copied into a temporary project first, and the export runs
// against that copy. --to must not exist yet. Pass the same directory as --persist-to to
// packet.mjs, with the `v3` folder inside it. Nothing here touches production.
//
// The copy holds personal data from the local database. Delete it when the rehearsal is done.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repositoryDirectory } from '../project-library.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
if (args.length !== 4 || !option('--from') || !option('--to')) {
  console.error('usage: node scripts/editorial/throwaway-copy.mjs --from <wrangler state directory> --to <new persist directory>');
  process.exit(64);
}
const from = path.resolve(option('--from'));
const to = path.resolve(option('--to'));
if (!existsSync(path.join(from, 'v3'))) { console.error(`No v3 folder in ${from}; --from must be a Wrangler state directory.`); process.exit(64); }
if (existsSync(to)) { console.error(`${to} already exists; choose a new directory.`); process.exit(64); }

const wranglerBin = path.join(repositoryDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const run = (cwd, ...wranglerArgs) => execFileSync(process.execPath, [wranglerBin, ...wranglerArgs], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
const work = mkdtempSync(path.join(tmpdir(), 'firelands-throwaway-'));
try {
  // `wrangler d1 export` has no --persist-to, so export from a project directory holding a copy of the source state.
  const project = path.join(work, 'project');
  mkdirSync(path.join(project, '.wrangler'), { recursive: true });
  cpSync(from, path.join(project, '.wrangler', 'state'), { recursive: true });
  writeFileSync(path.join(project, 'wrangler.jsonc'), readFileSync(path.join(repositoryDirectory, 'wrangler.jsonc')));
  const schemaFile = path.join(work, 'schema.sql'), dataFile = path.join(work, 'data.sql'), dump = path.join(work, 'restore.sql');
  run(project, 'd1', 'export', 'DB', '--local', '--no-data', '--output', schemaFile, '--skip-confirmation');
  run(project, 'd1', 'export', 'DB', '--local', '--no-schema', '--output', dataFile, '--skip-confirmation');
  // Tables and indexes, then rows, then triggers, so the news triggers cannot queue Facebook posts while rows reload.
  const schema = readFileSync(schemaFile, 'utf8');
  const triggerAt = schema.search(/^CREATE TRIGGER /m);
  const head = triggerAt < 0 ? schema : schema.slice(0, triggerAt);
  const triggers = triggerAt < 0 ? '' : schema.slice(triggerAt);
  if (/^CREATE (TABLE|INDEX|UNIQUE INDEX|VIEW) /m.test(triggers)) throw new Error('the schema export has statements after its triggers; check the restore order');
  writeFileSync(dump, ['PRAGMA defer_foreign_keys=TRUE;', head, readFileSync(dataFile, 'utf8'), triggers].join('\n'));
  mkdirSync(to, { recursive: true });
  run(repositoryDirectory, 'd1', 'execute', 'DB', '--local', '--persist-to', to, '--file', dump, '--yes');
  // Media rows point at R2 objects; copy the bucket so reused photos still resolve.
  cpSync(path.join(from, 'v3', 'r2'), path.join(to, 'v3', 'r2'), { recursive: true });
  console.log(`Throwaway copy ready: ${to}`);
} catch (error) {
  rmSync(to, { recursive: true, force: true });
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
