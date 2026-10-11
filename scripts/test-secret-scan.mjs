// Isolated tests for the secret-scanning hooks. Each case builds a throwaway Git
// repository in the OS temp directory (never this one), copies in the real hooks,
// scanner wrapper, and config, and drives real `git commit` / `git push`.
// The fake credential is assembled at run time so this file never contains it.
// The blocking cases need the pinned scanner: `npm run secrets:install` first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GITLEAKS_VERSION, resolveScanner } from './secret-scan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanner = (() => {
  try { return resolveScanner(repoRoot); } catch { return null; }
})();
const needScanner = scanner ? false : `gitleaks ${GITLEAKS_VERSION} is not installed (npm run secrets:install)`;

// Shaped like an AWS access key id, but made up: it grants access to nothing.
const FAKE_KEY = ['AKIA', 'ZKQT5WNB7XLRM3DH'].join('');
const secretFile = `aws_access_key_id = ${FAKE_KEY}\n`;

const roots = [];
test.after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'GITLEAKS_BIN') delete env[key];
  return { ...env, ...extra };
}

function run(cwd, command, args, env, input) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', windowsHide: true });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'secret-scan-fixture-'));
  roots.push(dir);
  mkdirSync(path.join(dir, 'scripts'));
  copyFileSync(path.join(repoRoot, 'scripts', 'secret-scan.mjs'), path.join(dir, 'scripts', 'secret-scan.mjs'));
  copyFileSync(path.join(repoRoot, '.gitleaks.toml'), path.join(dir, '.gitleaks.toml'));
  cpSync(path.join(repoRoot, '.githooks'), path.join(dir, '.githooks'), { recursive: true });
  const git = (...args) => {
    const result = run(dir, 'git', args, cleanEnv({ GITLEAKS_BIN: scanner ?? '' }));
    return result;
  };
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['config', 'commit.gpgsign', 'false'],
    ['config', 'core.autocrlf', 'false'],
    ['config', 'core.hooksPath', '.githooks'],
  ]) assert.equal(git(...args).status, 0);
  return { dir, git, write: (name, text) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  } };
}

// Runs git with the scanner forced to a given state.
function gitWith(fx, env, ...args) {
  return run(fx.dir, 'git', args, cleanEnv(env));
}

test('commit is blocked when the scanner is not installed', () => {
  const fx = fixture();
  fx.write('notes.txt', 'nothing sensitive\n');
  fx.git('add', '.');
  // No GITLEAKS_BIN and an empty managed directory: the real "missing" case.
  const result = gitWith(fx, {}, 'commit', '-m', 'Add notes');
  assert.notEqual(result.status, 0);
  assert.match(result.out, /BLOCKED/);
  assert.match(result.out, /npm run secrets:install/);
  assert.match(result.out, /--no-verify/);
  assert.notEqual(fx.git('rev-parse', '--verify', 'HEAD').status, 0, 'no commit may be created');
});

test('commit is blocked when GITLEAKS_BIN points nowhere or at the wrong program', () => {
  const fx = fixture();
  fx.write('notes.txt', 'nothing sensitive\n');
  fx.git('add', '.');
  for (const bin of [path.join(fx.dir, 'no-such-gitleaks'), process.execPath]) {
    const result = gitWith(fx, { GITLEAKS_BIN: bin }, 'commit', '-m', 'Add notes');
    assert.notEqual(result.status, 0, bin);
    assert.match(result.out, /BLOCKED/);
  }
  assert.notEqual(fx.git('rev-parse', '--verify', 'HEAD').status, 0);
});

test('push is blocked when the scanner is not installed', () => {
  const fx = fixture();
  fx.write('notes.txt', 'nothing sensitive\n');
  fx.git('add', '.');
  assert.equal(fx.git('commit', '--no-verify', '-m', 'Add notes').status, 0);
  const remote = mkdtempSync(path.join(os.tmpdir(), 'secret-scan-remote-'));
  roots.push(remote);
  assert.equal(run(remote, 'git', ['init', '-q', '--bare', '-b', 'main'], cleanEnv()).status, 0);
  fx.git('remote', 'add', 'origin', remote);
  const result = gitWith(fx, {}, 'push', 'origin', 'main');
  assert.notEqual(result.status, 0);
  assert.match(result.out, /BLOCKED/);
  assert.equal(run(remote, 'git', ['for-each-ref'], cleanEnv()).out.trim(), '', 'nothing may reach the remote');
});

test('a scanner failure blocks instead of passing', { skip: needScanner }, () => {
  const fx = fixture();
  fx.write('.gitleaks.toml', 'this is [not valid toml\n');
  fx.write('notes.txt', 'nothing sensitive\n');
  fx.git('add', '.');
  const result = fx.git('commit', '-m', 'Add notes');
  assert.notEqual(result.status, 0);
  assert.match(result.out, /BLOCKED/);
  assert.doesNotMatch(result.out, /no leaks found/);
});

test('pre-commit blocks a staged secret without printing it', { skip: needScanner }, () => {
  const fx = fixture();
  fx.write('config.txt', secretFile);
  fx.git('add', '.');
  const result = fx.git('commit', '-m', 'Add config');
  assert.notEqual(result.status, 0);
  assert.match(result.out, /BLOCKED - possible secrets/);
  assert.match(result.out, /aws-access-token/);
  assert.match(result.out, /config\.txt/);
  assert.doesNotMatch(result.out, new RegExp(FAKE_KEY), 'the credential must be redacted');
  assert.doesNotMatch(result.out, /ZKQT5WNB7XLRM3DH/);
  assert.notEqual(fx.git('rev-parse', '--verify', 'HEAD').status, 0, 'no commit may be created');
  assert.match(run(fx.dir, 'git', ['diff', '--cached', '--name-only'], cleanEnv()).out, /^config\.txt$/m, 'the change stays staged');
});

test('pre-commit lets a clean change through', { skip: needScanner }, () => {
  const fx = fixture();
  fx.write('notes.txt', 'nothing sensitive\n');
  fx.git('add', '.');
  const result = fx.git('commit', '-m', 'Add notes');
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /no leaks found/);
});

test('--no-verify is the documented emergency bypass for commits', { skip: needScanner }, () => {
  const fx = fixture();
  fx.write('config.txt', secretFile);
  fx.git('add', '.');
  assert.equal(fx.git('commit', '--no-verify', '-m', 'Bypass').status, 0);
});

test('pre-push blocks commits that carry a secret and passes clean ones', { skip: needScanner }, () => {
  const fx = fixture();
  const remote = mkdtempSync(path.join(os.tmpdir(), 'secret-scan-remote-'));
  roots.push(remote);
  assert.equal(run(remote, 'git', ['init', '-q', '--bare', '-b', 'main'], cleanEnv()).status, 0);
  fx.git('remote', 'add', 'origin', remote);
  const refs = () => run(remote, 'git', ['for-each-ref', '--format=%(refname)'], cleanEnv()).out.trim();

  fx.write('notes.txt', 'nothing sensitive\n');
  fx.git('add', '.');
  assert.equal(fx.git('commit', '-m', 'Add notes').status, 0);
  const first = fx.git('push', 'origin', 'main');
  assert.equal(first.status, 0, first.out);
  assert.equal(refs(), 'refs/heads/main');

  // A secret that skipped the commit hook is still caught on the way out.
  fx.write('config.txt', secretFile);
  fx.git('add', '.');
  assert.equal(fx.git('commit', '--no-verify', '-m', 'Add config').status, 0);
  const blocked = fx.git('push', 'origin', 'main');
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.out, /BLOCKED - possible secrets/);
  assert.match(blocked.out, /--no-verify/);
  assert.doesNotMatch(blocked.out, new RegExp(FAKE_KEY));
  const tip = fx.git('rev-parse', 'HEAD~1').out.trim();
  assert.equal(run(remote, 'git', ['rev-parse', 'main'], cleanEnv()).out.trim(), tip, 'the remote must not advance');

  // A new branch that carries the same commit is blocked too.
  const branch = fx.git('push', 'origin', 'main:topic');
  assert.notEqual(branch.status, 0);
  assert.equal(refs(), 'refs/heads/main');

  // Dropping the commit makes the push clean again.
  assert.equal(fx.git('reset', '-q', '--hard', 'HEAD~1').status, 0);
  fx.write('more.txt', 'still nothing sensitive\n');
  fx.git('add', '.');
  assert.equal(fx.git('commit', '-m', 'Add more').status, 0);
  const clean = fx.git('push', 'origin', 'main');
  assert.equal(clean.status, 0, clean.out);
});

test('the history scan finds a committed secret', { skip: needScanner }, () => {
  const fx = fixture();
  fx.write('config.txt', secretFile);
  fx.git('add', '.');
  assert.equal(fx.git('commit', '--no-verify', '-m', 'Add config').status, 0);
  const result = run(fx.dir, process.execPath, ['scripts/secret-scan.mjs', 'history'], cleanEnv({ GITLEAKS_BIN: scanner }));
  assert.equal(result.status, 1);
  assert.match(result.out, /BLOCKED - possible secrets/);
  assert.doesNotMatch(result.out, new RegExp(FAKE_KEY));
});

test('the test-secret allowlist is limited to the Node test scripts', { skip: needScanner }, () => {
  const line = "const env = { BETTER_AUTH_SECRET: 'quota-regression-secret-at-least-32-characters' };\n";
  const fx = fixture();
  fx.write('scripts/test-example.mjs', line);
  fx.git('add', '.');
  assert.equal(fx.git('commit', '-m', 'Test fixture').status, 0);

  fx.write('src/lib/example.ts', line);
  fx.git('add', '.');
  const result = fx.git('commit', '-m', 'Same value in app code');
  assert.notEqual(result.status, 0);
  assert.match(result.out, /generic-api-key/);
});
