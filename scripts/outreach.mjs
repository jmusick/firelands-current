import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outreachDirectory } from './project-library.mjs';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function website(value) {
  const url = new URL(value);
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Expected a public HTTP(S) URL');
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

export function validateTracker(tracker) {
  requireValue(tracker?.version === 1 && Array.isArray(tracker.contacts) && Array.isArray(tracker.referrals), 'Expected version 1, contacts and referrals');
  const ids = new Set();
  for (const entry of tracker.contacts) {
    requireValue(text(entry.id) && !ids.has(entry.id), 'Contact ids must be nonempty and unique');
    ids.add(entry.id);
    for (const field of ['organization', 'contact', 'relevance', 'evidence']) requireValue(text(entry[field]), `${entry.id}: missing ${field}`);
    website(entry.relevantPage);
    website(entry.destinationUrl);
    requireValue(new URL(entry.destinationUrl).origin === 'https://firelandscurrent.com', `${entry.id}: use a canonical newspaper destination`);
    requireValue(['pending', 'approved', 'declined'].includes(entry.authorization?.status), `${entry.id}: invalid authorization`);
    if (entry.authorization.status === 'approved') {
      requireValue(date(entry.authorization.on) && text(entry.authorization.evidence), `${entry.id}: approval needs a date and evidence`);
    }
    requireValue(entry.sentOn === null || date(entry.sentOn), `${entry.id}: invalid sentOn`);
    if (entry.sentOn !== null) requireValue(entry.authorization.status === 'approved' && entry.authorization.on <= entry.sentOn, `${entry.id}: sent outreach needs prior authorization`);
    requireValue(text(entry.response) && text(entry.followUp?.action), `${entry.id}: record response and follow-up, including unknown/none`);
    requireValue(entry.followUp.on === null || date(entry.followUp.on), `${entry.id}: invalid follow-up date`);
    requireValue(Array.isArray(entry.backlinks), `${entry.id}: backlinks must be an array`);
    for (const link of entry.backlinks) {
      requireValue(website(link.url) !== 'firelandscurrent.com', `${entry.id}: backlink must be external`);
      requireValue(new URL(link.destinationUrl).origin === 'https://firelandscurrent.com', `${entry.id}: invalid backlink destination`);
      requireValue(date(link.checkedOn) && typeof link.live === 'boolean' && typeof link.relevant === 'boolean' && text(link.evidence), `${entry.id}: backlink needs dated verification and relevance`);
    }
  }
  const periods = new Map();
  for (const row of tracker.referrals) {
    const host = website(row.website);
    requireValue(date(row.from) && date(row.through) && row.from <= row.through, 'Invalid referral period');
    requireValue(Number.isSafeInteger(row.sessions) && row.sessions >= 0 && text(row.evidence), 'Referral sessions need a nonnegative integer and evidence');
    const previous = periods.get(host) ?? [];
    requireValue(!previous.some(p => row.from <= p.through && p.from <= row.through), `Overlapping referral periods for ${host}`);
    periods.set(host, [...previous, row]);
  }
  return tracker;
}

export function summarizeTracker(tracker) {
  validateTracker(tracker);
  const links = new Map();
  for (const entry of tracker.contacts) for (const link of entry.backlinks) {
    const key = new URL(link.url).href;
    const previous = links.get(key);
    // A later missing-link observation supersedes an earlier success.
    if (!previous || link.checkedOn >= previous.checkedOn) links.set(key, link);
  }
  const websites = [...new Set([...links.values()].filter(link => link.live && link.relevant).map(link => website(link.url)))].sort();
  const referrals = new Map();
  for (const row of tracker.referrals) {
    const period = `${row.from} to ${row.through}`;
    referrals.set(period, (referrals.get(period) ?? 0) + row.sessions);
  }
  return {
    contacts: tracker.contacts.length,
    sent: tracker.contacts.filter(entry => entry.sentOn !== null).length,
    uniqueRelevantLinkingWebsites: websites.length,
    websites,
    referralSessionsByPeriod: Object.fromEntries([...referrals].sort()),
  };
}

export function run(args) {
  requireValue(args.length === 1 && ['init', 'check', 'summary'].includes(args[0]), 'Usage: node scripts/outreach.mjs init|check|summary');
  const file = join(outreachDirectory(), 'tracker.json');
  if (args[0] === 'init') {
    mkdirSync(outreachDirectory(), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, contacts: [], referrals: [] }, null, 2) + '\n', { flag: 'wx' });
    return `Created ${file}`;
  }
  const tracker = validateTracker(JSON.parse(readFileSync(file, 'utf8')));
  return args[0] === 'check' ? `Valid: ${file}` : JSON.stringify(summarizeTracker(tracker), null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(run(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
