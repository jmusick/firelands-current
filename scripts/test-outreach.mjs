import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { summarizeTracker, validateTracker } from './outreach.mjs';

const contact = id => ({
  id, organization: 'Library', relevantPage: 'https://library.example/resources',
  contact: 'Resource editor', relevance: 'Local resources', destinationUrl: 'https://firelandscurrent.com/',
  authorization: { status: 'pending' }, sentOn: null, response: 'Not sent',
  followUp: { on: null, action: 'Review' }, evidence: 'draft.md', backlinks: [],
});
const link = (url, checkedOn = '2026-11-15', live = true) => ({
  url, checkedOn, live, relevant: true, destinationUrl: 'https://firelandscurrent.com/', evidence: 'check.md',
});
const tracker = () => ({ version: 1, contacts: [contact('library')], referrals: [] });

test('count websites across contacts, excluding missing and irrelevant links', () => {
  const data = tracker();
  data.contacts.push(contact('second-contact'));
  data.contacts[0].backlinks = [link('https://www.library.example/one'), link('https://library.example/two'), link('https://other.example/')];
  data.contacts[1].backlinks = [link('https://www.library.example/one', '2026-11-16', false), { ...link('https://unrelated.example/'), relevant: false }];
  assert.deepEqual(summarizeTracker(data).websites, ['library.example', 'other.example']);
  data.contacts[1].backlinks.push(link('https://library.example/two', '2026-11-16', false));
  assert.equal(summarizeTracker(data).uniqueRelevantLinkingWebsites, 1);
});

test('sent outreach requires dated prior approval and distinct ids', () => {
  const data = tracker();
  data.contacts[0].sentOn = '2026-11-15';
  assert.throws(() => validateTracker(data), /prior authorization/);
  data.contacts[0].authorization = { status: 'approved', on: '2026-11-16', evidence: 'approval.md' };
  assert.throws(() => validateTracker(data), /prior authorization/);
  data.contacts[0].authorization.on = '2026-11-14';
  assert.equal(summarizeTracker(data).sent, 1);
  data.contacts.push(contact('library'));
  assert.throws(() => validateTracker(data), /unique/);
});

test('referrals group exact windows and reject duplicate or overlapping reports', () => {
  const data = tracker();
  const row = { website: 'https://library.example/', from: '2026-11-01', through: '2026-11-07', sessions: 3, evidence: 'analytics.md' };
  data.referrals = [row, { ...row, website: 'https://other.example/', sessions: 2 }, { ...row, from: '2026-11-08', through: '2026-11-14', sessions: 0 }];
  assert.deepEqual(summarizeTracker(data).referralSessionsByPeriod, { '2026-11-01 to 2026-11-07': 5, '2026-11-08 to 2026-11-14': 0 });
  data.referrals.push({ ...row, website: 'https://www.library.example/', from: '2026-11-07', through: '2026-11-10' });
  assert.throws(() => validateTracker(data), /Overlapping/);
});

test('reject impossible dates, non-HTTP links and unsupported schema versions', () => {
  const data = tracker();
  data.contacts[0].followUp.on = '2026-02-30';
  assert.throws(() => validateTracker(data), /date/);
  data.contacts[0].followUp.on = null;
  data.contacts[0].relevantPage = 'javascript:alert(1)';
  assert.throws(() => validateTracker(data), /HTTP/);
  assert.throws(() => validateTracker({ ...tracker(), version: 2 }), /version/);
});

test('CLI respects the library override, refuses overwrites and fails on bad usage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'firelands-outreach-'));
  const run = (...args) => spawnSync(process.execPath, ['scripts/outreach.mjs', ...args], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, FIRELANDS_PROJECT_DIR: directory }, encoding: 'utf8',
  });
  try {
    assert.equal(run('init').status, 0);
    const file = join(directory, 'outreach', 'tracker.json');
    const original = readFileSync(file, 'utf8');
    assert.equal(run('init').status, 1);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(run('check').status, 0);
    assert.deepEqual(JSON.parse(run('summary').stdout).referralSessionsByPeriod, {});
    assert.equal(run('summary', '--unexpected').status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
