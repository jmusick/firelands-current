import { fmtDates } from './events';
import type { Thread } from './forum';

/**
 * Recurring events get one discussion per occurrence with the same title and summary, so an event discussion is
 * named by when the event happens (never when the discussion was created). Uses the event pages' date wording;
 * the dates are plain YYYY-MM-DD values, so they cannot shift a day. Other discussions are untouched.
 */
type Dated = Pick<Thread, 'title' | 'kind' | 'event_starts_on' | 'event_ends_on'>;

/** "Wednesday, October 14, 2026" or "October 3–5, 2026"; null when the discussion isn't about an event. */
export function eventWhen(thread: Dated): string | null {
  if (thread.kind !== 'event' || !thread.event_starts_on) return null;
  return fmtDates({ starts_on: thread.event_starts_on, ends_on: thread.event_ends_on }, { year: true });
}

/** The discussion's title with the event's dates: "Jail tour on Wednesday, October 14, 2026". */
export function threadHeading(thread: Dated): string {
  const when = eventWhen(thread);
  if (!when) return thread.title;
  return `${thread.title} ${thread.event_ends_on ? 'from' : 'on'} ${when}`;
}

/** The meta description; event discussions lead with their dates so occurrences don't read as duplicates. */
export function threadDescription(thread: Dated & Pick<Thread, 'body'>): string {
  const when = eventWhen(thread);
  return when ? `${thread.event_ends_on ? 'Event runs' : 'Event is on'} ${when}. ${thread.body}` : thread.body;
}
