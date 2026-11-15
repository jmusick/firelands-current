// Where the production modes run: real production (Cloudflare D1/R2 through Wrangler `--remote`) or a
// rehearsal, which runs the identical code against a second throwaway local copy (`--local --persist-to`).
// Everything the production modes do to a target goes through these few calls, so a rehearsal exercises
// the same SQL, the same journals and the same checks as the real run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repositoryDirectory } from '../../project-library.mjs';
import { assertLocalOrigin } from './http.mjs';
import { DEFAULT_STATE } from './local.mjs';
import { SITE } from './util.mjs';

const wranglerBin = join(repositoryDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function wrangler(args) {
  try {
    return execFileSync(process.execPath, [wranglerBin, ...args], { cwd: repositoryDirectory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error('Wrangler failed: ' + (error.stdout || error.stderr || error.message));
  }
}

const bucketName = () => /"bucket_name"\s*:\s*"([^"]+)"/.exec(readFileSync(join(repositoryDirectory, 'wrangler.jsonc'), 'utf8'))?.[1];

function makeTarget(name, origin, scope) {
  return {
    name, origin,
    query(sql) {
      const output = wrangler(['d1', 'execute', 'DB', ...scope, '--command', sql, '--json']);
      const result = JSON.parse(output.slice(output.indexOf('[')));
      assert(result.every(row => row.success), 'A D1 query failed');
      return result.map(row => row.results);
    },
    executeFile(path) {
      return wrangler(['d1', 'execute', 'DB', ...scope, '--file', path, '--yes']);
    },
    putObject(key, path, contentType) {
      const bucket = bucketName();
      assert(bucket, 'No R2 bucket in wrangler.jsonc');
      return wrangler(['r2', 'object', 'put', `${bucket}/${key}`, ...scope, '--file', path, '--content-type', contentType]);
    },
  };
}

/** Real production. The caller must have been given --production; the CLI refuses otherwise. */
export const productionTarget = () => makeTarget('production', SITE, ['--remote']);

/** A second local copy standing in for production, with its own dev server for the live-page checks. */
export function rehearsalTarget({ stateDir, origin, localStateDir = DEFAULT_STATE }) {
  const dir = resolve(stateDir);
  assert.notEqual(dir, resolve(localStateDir), 'The rehearsal copy must not be the local database being imported from');
  assert.notEqual(dir, resolve(DEFAULT_STATE), 'The rehearsal copy must be a throwaway directory, not the working local database');
  return makeTarget('rehearsal', assertLocalOrigin(origin), ['--local', '--persist-to', dir]);
}
