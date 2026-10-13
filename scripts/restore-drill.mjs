// Backup restore drill (issue #15): export the D1 database, load the export into
// a throwaway local database, and check that the copy is complete and usable.
//
//   node scripts/restore-drill.mjs           drill against the local database
//   node scripts/restore-drill.mjs --remote  export production (read-only), restore it locally
//
// Nothing is ever written to production or to the local working database. The
// export and the restored copy hold personal data, so both live in a fresh OS
// temp directory that is deleted when the drill ends, however it ends. Only
// table names, row counts, and media keys are printed, never row contents.
// The procedure this exercises is "Backups and recovery" in docs/operations.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { repositoryDirectory } from './project-library.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--remote')) {
  console.error('usage: node scripts/restore-drill.mjs [--remote]');
  process.exit(64);
}
const remote = args.includes('--remote');
const site = 'https://firelandscurrent.com';
const wranglerBin = path.join(repositoryDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const work = mkdtempSync(path.join(tmpdir(), 'firelands-restore-'));
const schemaFile = path.join(work, 'schema.sql');
const dataFile = path.join(work, 'data.sql');
const dump = path.join(work, 'restore.sql');
const state = path.join(work, 'state');
const failures = [];
const proxies = [];

function wrangler(...wranglerArgs) {
  execFileSync(process.execPath, [wranglerBin, ...wranglerArgs], { cwd: repositoryDirectory, stdio: ['ignore', 'ignore', 'inherit'] });
}

function check(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

function cleanUp() {
  rmSync(work, { recursive: true, force: true });
}
process.on('SIGINT', () => { cleanUp(); process.exit(130); });

try {
  const started = Date.now();
  console.log(`Exporting the ${remote ? 'production' : 'local'} database…`);
  const target = remote ? '--remote' : '--local';
  wrangler('d1', 'export', 'DB', target, '--no-data', '--output', schemaFile, '--skip-confirmation');
  wrangler('d1', 'export', 'DB', target, '--no-schema', '--output', dataFile, '--skip-confirmation');
  const exported = Date.now();

  // A full export lists tables in creation order, but forum_threads gained a
  // reference to events (created later) in a migration, so loading it as-is
  // fails with "no such table: main.events". Restore in a fixed order instead:
  // tables and indexes, then rows, then triggers, so the news triggers don't
  // fire and queue Facebook posts while stories are reloaded.
  const schema = readFileSync(schemaFile, 'utf8');
  const triggerAt = schema.search(/^CREATE TRIGGER /m);
  const tablesAndIndexes = triggerAt < 0 ? schema : schema.slice(0, triggerAt);
  const triggers = triggerAt < 0 ? '' : schema.slice(triggerAt);
  if (/^CREATE (TABLE|INDEX|UNIQUE INDEX|VIEW) /m.test(triggers)) throw new Error('the schema export has statements after its triggers; check the restore order');
  const data = readFileSync(dataFile, 'utf8');
  writeFileSync(dump, ['PRAGMA defer_foreign_keys=TRUE;', tablesAndIndexes, data, triggers].join('\n'));

  // wrangler writes one INSERT per row, each starting a line.
  const expected = new Map();
  for (const [, table] of data.matchAll(/^INSERT INTO "([^"]+)"/gm)) expected.set(table, (expected.get(table) ?? 0) + 1);
  const createdTables = [...schema.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?"?([\w]+)"?/gm)].map(m => m[1]);
  const createdTriggers = [...triggers.matchAll(/^CREATE TRIGGER (\w+)/gm)].map(m => m[1]);

  console.log('Restoring into a throwaway local database…');
  wrangler('d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', dump, '--yes');
  const restored = Date.now();

  const copy = await getPlatformProxy({ configPath: path.join(repositoryDirectory, 'wrangler.jsonc'), persist: { path: path.join(state, 'v3') }, remoteBindings: false });
  proxies.push(copy);
  const db = copy.env.DB;
  const rows = async query => (await db.prepare(query).all()).results;

  const integrity = await rows('PRAGMA quick_check');
  check(integrity.length === 1 && integrity[0].quick_check === 'ok', 'SQLite quick_check');
  const orphans = await rows('PRAGMA foreign_key_check');
  check(orphans.length === 0, `foreign keys resolve${orphans.length ? ` (${orphans.length} dangling, first in ${orphans[0].table})` : ''}`);

  const tables = (await rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).map(r => r.name);
  const missing = createdTables.filter(t => !tables.includes(t));
  check(missing.length === 0, `all ${createdTables.length} exported tables exist${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  let total = 0;
  const mismatched = [];
  for (const table of tables) {
    const [{ n }] = await rows(`SELECT COUNT(*) AS n FROM "${table}"`);
    total += n;
    if (n !== (expected.get(table) ?? 0)) mismatched.push(`${table} ${n}/${expected.get(table) ?? 0}`);
  }
  check(mismatched.length === 0, `row counts match the export in ${tables.length} tables (${total} rows)${mismatched.length ? `: ${mismatched.join(', ')}` : ''}`);

  const restoredTriggers = (await rows("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map(r => r.name);
  const lostTriggers = createdTriggers.filter(t => !restoredTriggers.includes(t));
  check(createdTriggers.length > 0 && lostTriggers.length === 0, `all ${createdTriggers.length} triggers restored${lostTriggers.length ? ` (missing: ${lostTriggers.join(', ')})` : ''}`);

  const shipped = readdirSync(path.join(repositoryDirectory, 'migrations')).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied = (await rows('SELECT name FROM d1_migrations ORDER BY name')).map(r => r.name);
  const unapplied = shipped.filter(f => !applied.includes(f));
  check(unapplied.length === 0, `restored schema has all ${shipped.length} migrations${unapplied.length ? ` (not applied: ${unapplied.join(', ')})` : ''}`);

  // The app's own read paths: published stories and their library images.
  const [{ n: published }] = await rows("SELECT COUNT(*) AS n FROM news_articles WHERE status = 'published'");
  check(published > 0, `published stories readable (${published})`);

  // R2 has no backups of its own (see docs/operations.md), so the drill checks
  // that every library row still has its object in the live bucket.
  const media = await rows('SELECT object_key, bytes FROM media ORDER BY object_key');
  const absent = [];
  const wrongSize = [];
  if (remote) {
    for (const { object_key, bytes } of media) {
      const response = await fetch(`${site}/media/${object_key}`, { method: 'HEAD' });
      const length = Number(response.headers.get('content-length'));
      if (!response.ok) absent.push(object_key);
      else if (bytes > 0 && length && length !== bytes) wrongSize.push(object_key);
    }
  } else {
    const source = await getPlatformProxy({ configPath: path.join(repositoryDirectory, 'wrangler.jsonc'), persist: { path: path.join(repositoryDirectory, '.wrangler', 'state', 'v3') }, remoteBindings: false });
    proxies.push(source);
    for (const { object_key, bytes } of media) {
      const head = await source.env.MEDIA.head(object_key);
      if (!head) absent.push(object_key);
      else if (bytes > 0 && head.size !== bytes) wrongSize.push(object_key);
    }
  }
  check(absent.length === 0, `${media.length} media rows have an object in the ${remote ? 'production' : 'local'} bucket${absent.length ? ` (missing: ${absent.join(', ')})` : ''}`);
  check(wrongSize.length === 0, `media object sizes match their rows${wrongSize.length ? ` (differ: ${wrongSize.join(', ')})` : ''}`);

  const kb = Math.round((schema.length + data.length) / 1024);
  console.log(`\nExport ${kb} KB in ${((exported - started) / 1000).toFixed(1)} s; restore in ${((restored - exported) / 1000).toFixed(1)} s.`);
} catch (error) {
  failures.push(error.message);
  console.error(`FAIL ${error.message}`);
} finally {
  for (const proxy of proxies) await proxy.dispose();
  cleanUp();
}

console.log(failures.length ? `\nRestore drill FAILED (${failures.length}). The temporary copy was deleted.` : '\nRestore drill passed. The temporary copy was deleted.');
process.exit(failures.length ? 1 : 0);
