import { isCategory, today, type Category } from './events';
import { cleanText } from './forum';
import type { EventFormValues } from './events-admin';

/**
 * Validation for the public "Submit an event" form. The rules mirror the staff event editor
 * (`saveEventFromForm` in events-admin.ts) so a submission an editor can convert never trips its checks,
 * plus the ones a stranger's form needs: a contact email, and a start date that hasn't passed.
 */

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SPAN_DAYS = 366;
/** How far ahead an event may be submitted. */
const MAX_LEAD_DAYS = 800;
const DAY_MS = 86400000;

const validDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export type EventSubmission = {
  title: string; summary: string; description: string; category: Category;
  starts_on: string; start_time: string | null; ends_on: string | null; end_time: string | null;
  venue: string; address: string; community: string; organizer: string; cost: string; link: string;
  name: string; email: string; note: string;
};

/** The fields the form can report as invalid, in the order they appear on the page. */
export const EVENT_FIELDS = ['title', 'summary', 'description', 'category', 'starts_on', 'start_time', 'ends_on', 'end_time',
  'venue', 'address', 'community', 'organizer', 'cost', 'link', 'name', 'email', 'note'] as const;
export type EventField = typeof EVENT_FIELDS[number];

export type EventSubmissionResult =
  | { ok: true; submission: EventSubmission }
  | { ok: false; invalid: EventField[] };

export function validateEventSubmission(form: FormData, now = today()): EventSubmissionResult {
  const text = (name: string) => cleanText(form.get(name));
  const oneLine = (name: string) => text(name).replace(/[\r\n]+/g, ' ');
  const category = text('category');
  let link = text('link');
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  let endsOn = text('ends_on');
  const startsOn = text('starts_on');
  // A last day the same as the first is a single-day event.
  if (endsOn === startsOn) endsOn = '';
  const startTime = text('start_time');
  const endTime = text('end_time');

  const bad = new Set<EventField>();
  const title = oneLine('title');
  const summary = oneLine('summary');
  const description = text('description');
  const venue = oneLine('venue');
  const address = oneLine('address');
  const community = oneLine('community');
  const organizer = oneLine('organizer');
  const cost = oneLine('cost');
  const name = oneLine('name');
  const email = text('email');
  const note = text('note');

  if (title.length < 3 || title.length > 140) bad.add('title');
  if (summary.length < 10 || summary.length > 300) bad.add('summary');
  if (description.length > 5000) bad.add('description');
  if (!isCategory(category)) bad.add('category');
  if (!validDate(startsOn) || startsOn < now || daysBetween(now, startsOn) > MAX_LEAD_DAYS) bad.add('starts_on');
  if (endsOn) {
    if (!validDate(endsOn) || endsOn < startsOn || (validDate(startsOn) && daysBetween(startsOn, endsOn) > MAX_SPAN_DAYS)) bad.add('ends_on');
  }
  if (startTime && !TIME.test(startTime)) bad.add('start_time');
  if (endTime && !TIME.test(endTime)) bad.add('end_time');
  // An end time needs a start time, and on a one-day event it has to come after it. Several-day events use
  // the times as daily hours, so they are not compared.
  if (endTime && !startTime) bad.add('end_time');
  if (!endsOn && startTime && endTime && TIME.test(startTime) && TIME.test(endTime) && endTime <= startTime) bad.add('end_time');
  if (venue.length < 2 || venue.length > 120) bad.add('venue');
  if (address.length > 200) bad.add('address');
  if (!community || community.length > 60) bad.add('community');
  if (organizer.length > 120) bad.add('organizer');
  if (cost.length > 80) bad.add('cost');
  if (link) {
    try {
      const url = new URL(link);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || link.length > 500) throw new Error();
    } catch { bad.add('link'); }
  }
  if (!name || name.length > 100) bad.add('name');
  if (email.length > 200 || !EMAIL.test(email)) bad.add('email');
  if (note.length > 2000) bad.add('note');

  if (bad.size) return { ok: false, invalid: EVENT_FIELDS.filter((field) => bad.has(field)) };
  return {
    ok: true,
    submission: {
      title, summary, description, category: category as Category, starts_on: startsOn, start_time: startTime || null,
      ends_on: endsOn || null, end_time: (startTime && endTime) || null, venue, address, community, organizer, cost, link, name, email, note,
    },
  };
}

/** What the staff event editor starts from when an editor converts a submission: a draft with the organizer's details. */
export function valuesFromSubmission(s: EventSubmission & { id?: string }, base: EventFormValues): EventFormValues {
  return {
    ...base,
    title: s.title, summary: s.summary, description: s.description, category: s.category,
    starts_on: s.starts_on, start_time: s.start_time ?? '', ends_on: s.ends_on ?? '', end_time: s.end_time ?? '',
    venue: s.venue, address: s.address, community: s.community, organizer: s.organizer, cost: s.cost, link: s.link,
    status: 'draft',
  };
}
