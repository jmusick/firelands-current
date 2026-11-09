import { env } from 'cloudflare:workers';
import { statDay } from './ad-tracking';
import { LEAD_COLUMNS, type LeadImage } from './news';

export const CATEGORIES = {
  community: 'Community',
  arts: 'Arts & Culture',
  music: 'Music',
  family: 'Family & Kids',
  food: 'Food & Drink',
  sports: 'Sports & Recreation',
  outdoors: 'Outdoors',
  meetings: 'Government & Meetings',
  classes: 'Classes & Talks',
} as const;

export type Category = keyof typeof CATEGORIES;
export type EventStatus = 'draft' | 'published' | 'cancelled';
export const TICKET_AVAILABILITY = { InStock: 'Available', SoldOut: 'Sold out', PreOrder: 'Preorder' } as const;
export type TicketAvailability = keyof typeof TICKET_AVAILABILITY | '';
export type PerformerType = 'Person' | 'PerformingGroup';
export const STATUS_LABELS: Record<EventStatus, string> = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' };

export function isCategory(value: string | null | undefined): value is Category {
  return typeof value === 'string' && Object.hasOwn(CATEGORIES, value);
}

/**
 * Dates are YYYY-MM-DD and times HH:MM (24-hour), both Eastern wall-clock values. hours_note, when set, stands in for the
 * times on events whose hours differ by day.
 */
export type EventTiming = { starts_on: string; start_time: string | null; ends_on: string | null; end_time: string | null; hours_note: string };

export type CalendarEvent = EventTiming & {
  id: string; slug: string; title: string; summary: string; description: string; category: Category;
  venue: string; address: string; community: string; organizer: string; organizer_url: string; cost: string; link: string;
  performer: string; performer_type: PerformerType; ticket_price: string; ticket_url: string; ticket_availability: TicketAvailability;
  status: Exclude<EventStatus, 'draft'>; updated_at: number;
} & LeadImage;

export type AdminEvent = Omit<CalendarEvent, 'status' | keyof LeadImage> & {
  status: EventStatus; image_media_id: string | null; created_at: number;
};

/** Today in Eastern time, as YYYY-MM-DD. An event is upcoming until its last day has passed. */
export const today = () => statDay();

const PUBLIC_COLUMNS = `e.id, e.slug, e.title, e.summary, e.description, e.category, e.starts_on, e.start_time, e.ends_on, e.end_time, e.hours_note,
  e.venue, e.address, e.community, e.organizer, e.organizer_url, e.cost, e.link,
  e.performer, e.performer_type, e.ticket_price, e.ticket_url, e.ticket_availability, e.status, e.updated_at, ${LEAD_COLUMNS}`;

export type EventFilters = { category?: Category; community?: string; past?: boolean };

export async function listEvents(filters: EventFilters, page = 0, pageSize = 30): Promise<CalendarEvent[]> {
  const result = await env.DB.prepare(`
    SELECT ${PUBLIC_COLUMNS}
    FROM events e LEFT JOIN media m ON m.id = e.image_media_id
    WHERE e.status != 'draft' AND (?1 IS NULL OR e.category = ?1) AND (?2 IS NULL OR e.community = ?2)
      AND ${filters.past ? 'COALESCE(e.ends_on, e.starts_on) < ?3' : 'COALESCE(e.ends_on, e.starts_on) >= ?3'}
    ORDER BY ${filters.past ? 'e.starts_on DESC' : 'e.starts_on'}, COALESCE(e.start_time, ''), e.title
    LIMIT ?4 OFFSET ?5
  `).bind(filters.category ?? null, filters.community ?? null, today(), pageSize + 1, page * pageSize).all<CalendarEvent>();
  return result.results;
}

/** Events on any day from `from` through `to` (YYYY-MM-DD), including multi-day events that overlap them, for the month view. */
export async function listEventsBetween(filters: Omit<EventFilters, 'past'>, from: string, to: string): Promise<CalendarEvent[]> {
  const result = await env.DB.prepare(`
    SELECT ${PUBLIC_COLUMNS}
    FROM events e LEFT JOIN media m ON m.id = e.image_media_id
    WHERE e.status != 'draft' AND (?1 IS NULL OR e.category = ?1) AND (?2 IS NULL OR e.community = ?2)
      AND e.starts_on <= ?4 AND COALESCE(e.ends_on, e.starts_on) >= ?3
    ORDER BY e.starts_on, COALESCE(e.start_time, ''), e.title
    LIMIT 1000
  `).bind(filters.category ?? null, filters.community ?? null, from, to).all<CalendarEvent>();
  return result.results;
}

/** Communities with upcoming events, for the calendar's filter. */
export async function upcomingCommunities(): Promise<string[]> {
  const result = await env.DB.prepare(`
    SELECT DISTINCT community FROM events WHERE status != 'draft' AND COALESCE(ends_on, starts_on) >= ? ORDER BY community
  `).bind(today()).all<{ community: string }>();
  return result.results.map((r) => r.community);
}

export async function getEvent(slug: string): Promise<CalendarEvent | null> {
  return env.DB.prepare(`
    SELECT ${PUBLIC_COLUMNS}
    FROM events e LEFT JOIN media m ON m.id = e.image_media_id
    WHERE e.slug = ? AND e.status != 'draft'
  `).bind(slug).first<CalendarEvent>();
}

const ADMIN_COLUMNS = `id, slug, title, summary, description, category, starts_on, start_time, ends_on, end_time, hours_note,
  venue, address, community, organizer, organizer_url, cost, link, performer, performer_type, ticket_price, ticket_url, ticket_availability,
  image_media_id, status, created_at, updated_at`;

export async function listAdminEvents(): Promise<AdminEvent[]> {
  const result = await env.DB.prepare(`SELECT ${ADMIN_COLUMNS} FROM events ORDER BY starts_on DESC, COALESCE(start_time, '') DESC LIMIT 2000`).all<AdminEvent>();
  return result.results;
}

export async function getAdminEvent(id: string): Promise<AdminEvent | null> {
  return env.DB.prepare(`SELECT ${ADMIN_COLUMNS} FROM events WHERE id = ?`).bind(id).first<AdminEvent>();
}

export const lastDay = (e: EventTiming) => e.ends_on ?? e.starts_on;
export const isPast = (e: EventTiming) => lastDay(e) < today();

// ---- Formatting ----

export const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

const parseTime = (time: string) => time.split(':').map(Number) as [number, number];

/** Newspaper style: "7 p.m.", "7:30 a.m.", "noon", "midnight". */
export function fmtTime(time: string): string {
  const [h, m] = parseTime(time);
  if (m === 0 && h === 12) return 'noon';
  if (m === 0 && h === 0) return 'midnight';
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

/**
 * "7–9 p.m.", "10 a.m.–2 p.m.", "7 p.m." or "All day"; on multi-day events these are the daily hours. Events with an
 * hours note read "Hours vary" here, since listings have no room for it; fullHours gives the note itself.
 */
export function fmtHours(e: EventTiming): string {
  if (e.hours_note) return 'Hours vary';
  if (!e.start_time) return 'All day';
  if (!e.end_time) return fmtTime(e.start_time);
  const start = fmtTime(e.start_time);
  const end = fmtTime(e.end_time);
  const sameHalf = / [ap]\.m\.$/.test(start) && start.slice(-4) === end.slice(-4);
  return `${sameHalf ? start.slice(0, -5) : start}–${end}`;
}

export const fullHours = (e: EventTiming) => e.hours_note || fmtHours(e);

/** "Saturday, October 3" or "October 3–5" / "October 30 – November 2" for multi-day events. */
export function fmtDates(e: Pick<EventTiming, 'starts_on' | 'ends_on'>, opts: { year?: boolean } = {}): string {
  const year = opts.year ? { year: 'numeric' } as const : {};
  if (!e.ends_on) return fmtDay(e.starts_on, { weekday: 'long', month: 'long', day: 'numeric', ...year });
  const sameMonth = e.starts_on.slice(0, 7) === e.ends_on.slice(0, 7);
  const start = fmtDay(e.starts_on, { month: 'long', day: 'numeric' });
  const end = fmtDay(e.ends_on, sameMonth ? { day: 'numeric' } : { month: 'long', day: 'numeric' });
  return `${start}${sameMonth ? '–' : ' – '}${end}${opts.year ? `, ${e.ends_on.slice(0, 4)}` : ''}`;
}

export const mapsUrl = (e: { venue: string; address: string; community: string }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.venue, e.address || e.community, 'OH'].join(', '))}`;

/** The instant an Eastern wall-clock time falls on, accounting for daylight saving time. */
export function easternInstant(day: string, time = '00:00'): Date {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = parseTime(time);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  // Start from standard time and correct by however far off the clock reads; the second pass settles DST edges.
  let at = wall + 5 * 3600000;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]));
    at += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(at);
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Start and end as schema.org and calendar apps want them: dates for all-day events, instants otherwise. */
function span(e: EventTiming): { allDay: true; start: string; end: string } | { allDay: false; start: Date; end: Date | null } {
  if (!e.start_time) return { allDay: true, start: e.starts_on, end: lastDay(e) };
  return { allDay: false, start: easternInstant(e.starts_on, e.start_time), end: e.end_time ? easternInstant(lastDay(e), e.end_time) : null };
}

/** schema.org Event data, so search engines can show the event in their own listings. */
export function eventJsonLd(e: CalendarEvent, url: string, imageUrl: string | null): string {
  const s = span(e);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description: e.summary,
    url,
    startDate: s.allDay ? s.start : s.start.toISOString(),
    ...(s.allDay ? { endDate: s.end } : s.end ? { endDate: s.end.toISOString() } : {}),
    eventStatus: e.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: e.venue,
      address: { '@type': 'PostalAddress', ...(e.address ? { streetAddress: e.address } : {}), addressLocality: e.community, addressRegion: 'OH', addressCountry: 'US' },
    },
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(e.organizer ? { organizer: { '@type': 'Organization', name: e.organizer, ...(e.organizer_url ? { url: e.organizer_url } : {}) } } : {}),
    ...(e.performer ? { performer: { '@type': e.performer_type, name: e.performer } } : {}),
    ...(e.ticket_price !== '' ? { offers: {
      '@type': 'Offer', price: Number(e.ticket_price), priceCurrency: 'USD',
      ...(e.ticket_url ? { url: e.ticket_url } : {}),
      ...(e.ticket_availability ? { availability: `https://schema.org/${e.ticket_availability}` } : {}),
    } } : {}),
  };
  // Keeps "</script>" in any field from closing the tag it's written into.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsInstant = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = (day: string) => day.replace(/-/g, '');

/** Lines longer than 75 bytes continue on the next line after a space, as RFC 5545 requires. */
function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > (out.length ? 74 : 75)) { out.push(current); current = ''; bytes = 0; }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** A one-event iCalendar file for "Add to calendar". */
export function eventIcs(e: CalendarEvent, url: string): string {
  const s = span(e);
  const host = new URL(url).hostname;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Firelands Current//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${e.id}@${host}`,
    `DTSTAMP:${icsInstant(new Date(e.updated_at))}`,
    ...(s.allDay
      // An all-day event's end date is exclusive: the day after its last day.
      ? [`DTSTART;VALUE=DATE:${icsDate(s.start)}`, `DTEND;VALUE=DATE:${icsDate(addDays(s.end, 1))}`]
      : [`DTSTART:${icsInstant(s.start)}`, ...(s.end ? [`DTEND:${icsInstant(s.end)}`] : [])]),
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(`${e.summary}\n\n${url}`)}`,
    `LOCATION:${icsText([e.venue, e.address, e.community].filter(Boolean).join(', '))}`,
    `URL:${url}`,
    `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
