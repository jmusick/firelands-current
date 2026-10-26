// `npm test`: runs every `test:*` script's file in one `node --test` run, so CI and a local check cover
// the same list as the individual scripts. `test:a11y` is left out because it needs a dev server you
// start yourself (AGENTS.md). Each test file still runs in its own process.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NEEDS_SERVER = new Set(['test:a11y']);
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const files = [];
for (const [name, command] of Object.entries(scripts)) {
  if (!name.startsWith('test:') || NEEDS_SERVER.has(name)) continue;
  const match = /^node --test (\S+)$/.exec(command);
  if (!match) {
    console.error(`${name} is "${command}", not "node --test <file>", so npm test can't include it. Update scripts/run-tests.mjs.`);
    process.exit(1);
  }
  files.push(match[1]);
}

const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
