#!/usr/bin/env node
// Secret scanning with a pinned Gitleaks, shared by the Git hooks, the
// GitHub Actions workflow, and `npm run secrets:*`. Plain Node so it works the
// same in PowerShell, cmd, Git Bash, and Linux CI.
//
//   node scripts/secret-scan.mjs setup              point core.hooksPath at .githooks and install the scanner
//   node scripts/secret-scan.mjs install            download, verify, and unpack the pinned scanner
//   node scripts/secret-scan.mjs history            scan every commit on every ref
//   node scripts/secret-scan.mjs staged             scan the staged diff
//   node scripts/secret-scan.mjs hook pre-commit    what .githooks/pre-commit runs
//   node scripts/secret-scan.mjs hook pre-push R U  what .githooks/pre-push runs (ref list on stdin)
//
// Everything fails closed: a missing, wrong-version, or crashing scanner
// blocks the commit or push instead of letting it through. Findings are always
// redacted and written to the terminal only, never to a report file.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// To upgrade: pick a release at least two weeks old, copy its SHA-256 values
// from the official gitleaks_<version>_checksums.txt on the release page,
// update both constants, and run `npm run test:secret-scan`.
export const GITLEAKS_VERSION = '8.30.1';
const RELEASE_BASE = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;
const ARCHIVES = {
  'win32-x64': ['gitleaks_8.30.1_windows_x64.zip', 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'],
  'win32-arm64': ['gitleaks_8.30.1_windows_arm64.zip', 'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f'],
  'linux-x64': ['gitleaks_8.30.1_linux_x64.tar.gz', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
  'linux-arm64': ['gitleaks_8.30.1_linux_arm64.tar.gz', 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'],
  'darwin-x64': ['gitleaks_8.30.1_darwin_x64.tar.gz', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
  'darwin-arm64': ['gitleaks_8.30.1_darwin_arm64.tar.gz', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
};

const CONFIG = '.gitleaks.toml';
const HOOKS_DIR = '.githooks';
// Distinct from Gitleaks' own failure code (1) so a crash is never mistaken
// for a clean scan or a finding.
const LEAK_EXIT = 2;
const ZERO_SHA = /^0+$/;
const SHA = /^[0-9a-f]{40,64}$/;

class ScanError extends Error {}

const say = (message) => console.error(`secret-scan: ${message}`);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The scanner lives inside the repository's common git directory: untracked,
// never committed, and shared by every worktree of the same clone.
function scannerPaths(root) {
  let common;
  try {
    common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  } catch {
    throw new ScanError('this is not a Git working tree, so there is nowhere to keep the scanner.');
  }
  const dir = path.join(common, 'gitleaks', GITLEAKS_VERSION);
  return { dir, bin: path.join(dir, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks') };
}

function scannerVersion(bin) {
  const result = spawnSync(bin, ['version'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

// GITLEAKS_BIN is an explicit override (an operator-managed binary). It is
// held to the same exact-version rule and never falls back to the managed copy.
export function resolveScanner(root) {
  const override = process.env.GITLEAKS_BIN;
  const bin = override || scannerPaths(root).bin;
  if (!existsSync(bin)) {
    throw new ScanError(`gitleaks ${GITLEAKS_VERSION} was not found at ${bin}. Install it with: npm run secrets:install`);
  }
  const found = scannerVersion(bin);
  if (found !== GITLEAKS_VERSION) {
    throw new ScanError(`${bin} reports version ${found ?? 'unknown (it did not run)'}, but ${GITLEAKS_VERSION} is pinned. Reinstall with: npm run secrets:install`);
  }
  return bin;
}

function extract(archive, member, into) {
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  // Name the one member so nothing else in the archive is unpacked.
  const result = spawnSync(tar, ['-xf', archive, '-C', into, member], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new ScanError(`could not unpack ${path.basename(archive)} with ${tar}: ${(result.stderr || result.error?.message || '').trim()}`);
}

export async function installScanner(root) {
  if (process.env.GITLEAKS_BIN) {
    say(`using ${resolveScanner(root)} from GITLEAKS_BIN.`);
    return;
  }
  try {
    say(`gitleaks ${GITLEAKS_VERSION} is already installed at ${resolveScanner(root)}.`);
    return;
  } catch {
    // Missing or the wrong version: download the pinned one below.
  }
  const entry = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!entry) throw new ScanError(`no pinned gitleaks build for ${process.platform}-${process.arch}. Install version ${GITLEAKS_VERSION} yourself and point GITLEAKS_BIN at it.`);
  const [name, expected] = entry;
  const { dir, bin } = scannerPaths(root);

  say(`downloading ${name}`);
  const response = await fetch(`${RELEASE_BASE}/${name}`, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new ScanError(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new ScanError(`checksum mismatch for ${name} (expected ${expected}, got ${actual}). Nothing was installed.`);
  say('SHA-256 matches the value pinned from the official release checksums.');

  mkdirSync(dir, { recursive: true });
  const staging = mkdtempSync(path.join(dir, 'staging-'));
  try {
    const archive = path.join(staging, name);
    writeFileSync(archive, bytes);
    const member = path.basename(bin);
    extract(archive, member, staging);
    const unpacked = path.join(staging, member);
    if (process.platform !== 'win32') chmodSync(unpacked, 0o755);
    const found = scannerVersion(unpacked);
    if (found !== GITLEAKS_VERSION) throw new ScanError(`the unpacked scanner reports version ${found ?? 'unknown'}, expected ${GITLEAKS_VERSION}.`);
    rmSync(bin, { force: true });
    renameSync(unpacked, bin);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  say(`installed gitleaks ${GITLEAKS_VERSION} at ${bin}`);
}

// Runs the scanner with redacted, terminal-only output. Returns true when clean.
function scan(root, args, what) {
  const bin = resolveScanner(root);
  const result = spawnSync(bin, [
    ...args,
    '--config', CONFIG,
    '--redact=100',
    '--no-banner',
    '--no-color',
    '--verbose',
    // Allowlists live only in .gitleaks.toml, where they are reviewed; an
    // inline "gitleaks:allow" comment cannot silence a finding.
    '--ignore-gitleaks-allow',
    '--exit-code', String(LEAK_EXIT),
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status === 0) return true;
  if (result.status === LEAK_EXIT) {
    say(`BLOCKED - possible secrets found in ${what} (values are redacted above).`);
    say('Remove the secret from the change. If it was ever real, rotate it: removing it here does not make it safe.');
    say(`If it is a false positive, add a narrow, documented exception to ${CONFIG}.`);
    return false;
  }
  throw new ScanError(`gitleaks did not finish (${result.error?.message ?? `exit status ${result.status}`}), so ${what} was not checked.`);
}

function bypassHint(command) {
  say(`Emergency bypass (CI still scans every push and pull request): ${command}`);
}

// Resolves what a push would add on the remote, as `git log` arguments.
function pushedRange(root, remoteName, localSha, remoteSha) {
  if (!ZERO_SHA.test(remoteSha)) {
    try {
      git(root, ['cat-file', '-e', `${remoteSha}^{commit}`]);
      return [`${remoteSha}..${localSha}`];
    } catch {
      // The remote tip is not local (for example after a force push): fall through.
    }
  }
  // New branch or tag: everything not already on this remote. With an unknown
  // remote this degrades to scanning all reachable history, which is safe.
  return [localSha, '--not', `--remotes=${remoteName}`];
}

function hookPrePush(root, remoteName, input) {
  let clean = true;
  let scanned = 0;
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha = '0'] = line.trim().split(/\s+/);
    if (!SHA.test(localSha ?? '')) throw new ScanError('git sent a push update this hook could not parse, so it was not checked.');
    if (ZERO_SHA.test(localSha)) continue; // deleting a remote ref sends no content
    const range = pushedRange(root, remoteName, localSha, remoteSha);
    if (Number(git(root, ['rev-list', '--count', ...range])) === 0) continue;
    scanned += 1;
    if (!scan(root, ['git', `--log-opts=${range.join(' ')}`], `the commits being pushed (${range.join(' ')})`)) clean = false;
  }
  if (scanned === 0) say('no new commits to scan.');
  return clean;
}

function setup(root) {
  const current = (() => {
    try { return git(root, ['config', '--local', '--get', 'core.hooksPath']); } catch { return ''; }
  })();
  if (current && current !== HOOKS_DIR) {
    throw new ScanError(`core.hooksPath is already set to "${current}". Merge ${HOOKS_DIR}/ into it by hand, or unset it and run this again.`);
  }
  git(root, ['config', '--local', 'core.hooksPath', HOOKS_DIR]);
  say(`core.hooksPath is now ${HOOKS_DIR} (pre-commit and pre-push scan for secrets).`);
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'setup':
        setup(root);
        await installScanner(root);
        return 0;
      case 'install':
        await installScanner(root);
        return 0;
      case 'history':
        return scan(root, ['git'], 'the repository history') ? 0 : 1;
      case 'staged':
        return scan(root, ['git', '--pre-commit', '--staged'], 'the staged changes') ? 0 : 1;
      case 'hook': {
        const [name, ...hookArgs] = rest;
        if (name === 'pre-commit') {
          if (scan(root, ['git', '--pre-commit', '--staged'], 'the staged changes')) return 0;
          bypassHint('git commit --no-verify');
          return 1;
        }
        if (name === 'pre-push') {
          // Git feeds "<local ref> <local sha> <remote ref> <remote sha>" lines on stdin.
          if (hookPrePush(root, hookArgs[0] ?? '', readFileSync(0, 'utf8'))) return 0;
          bypassHint('git push --no-verify');
          return 1;
        }
        throw new ScanError(`unknown hook "${name ?? ''}".`);
      }
      default:
        say('usage: secret-scan.mjs setup | install | history | staged | hook pre-commit | hook pre-push <remote> <url>');
        return 64;
    }
  } catch (error) {
    // Anything unexpected is treated like a scanner failure: block, never pass.
    say(`BLOCKED - ${error.message}`);
    if (command === 'hook') {
      say('The scanner has to run before a commit or push goes through; this hook fails closed.');
      bypassHint(rest[0] === 'pre-push' ? 'git push --no-verify' : 'git commit --no-verify');
    }
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
