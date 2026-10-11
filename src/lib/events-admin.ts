import { env } from 'cloudflare:workers';
import { type AuditActor, auditRecord, auditResource, changedFields } from './audit';
import { type AdminEvent, type Category, type EventStatus, type PerformerType, type TicketAvailability, STATUS_LABELS, TICKET_AVAILABILITY, isCategory } from './events';
import { cleanText, ensureEventThread } from './forum';
import { isMediaId } from './media';
import { sanitizeSlug } from './news';

export type EventFormValues = {
  title: string; slug: string; summary: string; description: string; category: Category | '';
  starts_on: string; start_time: string; ends_on: string; end_time: string;
  /** Shown instead of the times when the hours differ by day; empty to show the times. */
  hours_note: string;
  venue: string; address: string; community: string; organizer: string; organizer_url: string; cost: string; link: string;
  performer: string; performer_type: PerformerType; ticket_price: string; ticket_url: string; ticket_availability: TicketAvailability;
  /** Media library item shown with the event; empty for none. */
  image_media_id: string;
  status: EventStatus;
};

export type EventFormResult =
  | { ok: true; id: string }
  | { ok: false; values: EventFormValues; errors: string[] };

export const emptyEvent: EventFormValues = {
  title: '', slug: '', summary: '', description: '', category: '', starts_on: '', start_time: '', ends_on: '', end_time: '', hours_note: '',
  venue: '', address: '', community: '', organizer: '', organizer_url: '', cost: '', link: '', image_media_id: '', status: 'draft',
  performer: '', performer_type: 'PerformingGroup', ticket_price: '', ticket_url: '', ticket_availability: '',
};

export function valuesFromEvent(e: AdminEvent): EventFormValues {
  const { title, slug, summary, description, category, starts_on, hours_note, venue, address, community, organizer, cost, link, status,
    performer, performer_type, ticket_price, ticket_url, ticket_availability, organizer_url } = e;
  return {
    title, slug, summary, description, category, starts_on, hours_note, venue, address, community, organizer, cost, link, status,
    performer, performer_type, ticket_price, ticket_url, ticket_availability, organizer_url,
    start_time: e.start_time ?? '', ends_on: e.ends_on ?? '', end_time: e.end_time ?? '', image_media_id: e.image_media_id ?? '',
  };
}

/** A new draft with an existing event's details, for repeating events: the dates and URL are left for the editor. */
export function copyOfEvent(e: AdminEvent): EventFormValues {
  return { ...valuesFromEvent(e), slug: '', starts_on: '', ends_on: '', status: 'draft' };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d));
const MAX_SPAN_DAYS = 366;

// Field names an audit entry lists when an event is edited. Status has its own actions.
const AUDITED_FIELDS: Record<string, string> = {
  title: 'title', slug: 'URL slug', summary: 'summary', description: 'details', category: 'category', starts_on: 'start date',
  start_time: 'start time', ends_on: 'last day', end_time: 'end time', hours_note: 'hours', venue: 'venue', address: 'address',
  community: 'community', organizer: 'organizer', organizer_url: 'organizer website', cost: 'cost', link: 'link',
  performer: 'performer', performer_type: 'performer type', ticket_price: 'ticket price', ticket_url: 'ticket URL',
  ticket_availability: 'ticket availability', image_media_id: 'image',
};

const STATUS_ACTIONS: Record<EventStatus, string> = { draft: 'event-unpublish', published: 'event-publish', cancelled: 'event-cancel' };

/** Audit statements for one save: a create, or an update naming only the fields that changed, plus status changes. */
function eventAudit(actor: AuditActor, id: string, values: EventFormValues, existing: AdminEvent | null) {
  const before = existing ? valuesFromEvent(existing) : null;
  const statements = [];
  if (!before) {
    statements.push(auditResource(actor, { type: 'event', id, label: values.title }, 'event-create', `/events/${values.slug}; ${values.status}`));
  } else {
    const changed = changedFields(before, values, AUDITED_FIELDS);
    if (changed.length) statements.push(auditRecord(actor, 'event', id, 'event-update', `Changed: ${changed.join(', ')}`));
  }
  if (values.status !== (before?.status ?? 'draft')) statements.push(auditRecord(actor, 'event', id, STATUS_ACTIONS[values.status]));
  return statements;
}

export async function saveEventFromForm(form: FormData, existing: AdminEvent | null, actor: AuditActor): Promise<EventFormResult> {
  const category = cleanText(form.get('category'));
  const status = cleanText(form.get('status'));
  const typedSlug = sanitizeSlug(cleanText(form.get('slug')));
  let link = cleanText(form.get('link'));
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  let ticketUrl = cleanText(form.get('ticket_url'));
  if (ticketUrl && !/^[a-z][a-z\d+.-]*:/i.test(ticketUrl)) ticketUrl = `https://${ticketUrl}`;
  let organizerUrl = cleanText(form.get('organizer_url'));
  if (organizerUrl && !/^[a-z][a-z\d+.-]*:/i.test(organizerUrl)) organizerUrl = `https://${organizerUrl}`;
  const performerType = cleanText(form.get('performer_type')) || 'PerformingGroup';
  const ticketAvailability = cleanText(form.get('ticket_availability'));
  const values: EventFormValues = {
    title: cleanText(form.get('title')),
    slug: typedSlug,
    summary: cleanText(form.get('summary')),
    description: cleanText(form.get('description')),
    category: isCategory(category) ? category : '',
    starts_on: cleanText(form.get('starts_on')),
    start_time: cleanText(form.get('start_time')),
    ends_on: cleanText(form.get('ends_on')),
    end_time: cleanText(form.get('end_time')),
    hours_note: cleanText(form.get('hours_note')),
    venue: cleanText(form.get('venue')),
    address: cleanText(form.get('address')),
    community: cleanText(form.get('community')),
    organizer: cleanText(form.get('organizer')),
    organizer_url: organizerUrl,
    cost: cleanText(form.get('cost')),
    link,
    performer: cleanText(form.get('performer')),
    performer_type: performerType === 'Person' ? 'Person' : 'PerformingGroup',
    ticket_price: cleanText(form.get('ticket_price')),
    ticket_url: ticketUrl,
    ticket_availability: Object.hasOwn(TICKET_AVAILABILITY, ticketAvailability) ? ticketAvailability as TicketAvailability : '',
    image_media_id: cleanText(form.get('image_media_id')),
    status: Object.hasOwn(STATUS_LABELS, status) ? status as EventStatus : 'draft',
  };
  // A last day the same as the first is a single-day event.
  if (values.ends_on === values.starts_on) values.ends_on = '';

  const errors: string[] = [];
  if (values.title.length < 3 || values.title.length > 140) errors.push('Title must be 3–140 characters.');
  if (values.summary.length < 10 || values.summary.length > 300) errors.push('Summary must be 10–300 characters.');
  if (values.description.length > 20000) errors.push('Details must be under 20,000 characters.');
  if (!values.category) errors.push('Choose a category.');
  if (!validDate(values.starts_on)) errors.push('Choose the date the event starts.');
  if (values.ends_on) {
    if (!validDate(values.ends_on)) errors.push('Last day must be a valid date.');
    else if (values.ends_on < values.starts_on) errors.push('Last day must be on or after the first day.');
    else if ((Date.parse(values.ends_on) - Date.parse(values.starts_on)) / 86400000 > MAX_SPAN_DAYS) errors.push('An event can run for at most a year.');
  }
  if (values.start_time && !TIME.test(values.start_time)) errors.push('Start time must be a valid time.');
  if (values.end_time && !TIME.test(values.end_time)) errors.push('End time must be a valid time.');
  if (values.end_time && !values.start_time) errors.push('Add a start time, or clear the end time for an all-day event.');
  if (!values.ends_on && values.start_time && values.end_time && values.end_time <= values.start_time) errors.push('End time must be after the start time.');
  if (values.hours_note.length > 80) errors.push('Hours must be under 80 characters.');
  if (values.venue.length < 2 || values.venue.length > 120) errors.push('Venue is required (up to 120 characters).');
  if (values.address.length > 200) errors.push('Address must be under 200 characters.');
  if (!values.community || values.community.length > 60) errors.push('Community is required (up to 60 characters).');
  if (values.organizer.length > 120) errors.push('Organizer must be under 120 characters.');
  if (values.organizer_url && !values.organizer) errors.push('Add the organizer name, or clear the organizer website.');
  if (values.organizer_url) {
    try {
      const url = new URL(values.organizer_url);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || values.organizer_url.length > 500) throw new Error();
    } catch { errors.push('Organizer website must be a valid web address without sign-in credentials.'); }
  }
  if (values.cost.length > 80) errors.push('Cost must be under 80 characters.');
  if (values.performer.length > 120) errors.push('Performer must be under 120 characters.');
  if (!['Person', 'PerformingGroup'].includes(performerType)) errors.push('Choose a valid performer type.');
  if (ticketAvailability && !Object.hasOwn(TICKET_AVAILABILITY, ticketAvailability)) errors.push('Choose a valid ticket availability.');
  if (values.ticket_price && !/^\d{1,6}(\.\d{1,2})?$/.test(values.ticket_price)) errors.push('Ticket price must be a dollar amount from 0 to 999999.99, with at most two decimal places.');
  if (!values.ticket_price && (values.ticket_url || values.ticket_availability)) errors.push('Add the ticket price, or clear the ticket URL and availability.');
  if (values.ticket_price && Number(values.ticket_price) > 0 && !values.ticket_url) errors.push('Add the ticket purchase URL for a paid event.');
  if (values.ticket_url) {
    try {
      const url = new URL(values.ticket_url);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || values.ticket_url.length > 500) throw new Error();
    } catch { errors.push('Ticket URL must be a valid web address without sign-in credentials.'); }
  }
  if (values.link) {
    try {
      const url = new URL(values.link);
      if (!/^https?:$/.test(url.protocol) || values.link.length > 500) throw new Error();
    } catch { errors.push('Link must be a valid web address.'); }
  }
  if (values.image_media_id && !(isMediaId(values.image_media_id) && await env.DB.prepare('SELECT 1 FROM media WHERE id = ?').bind(values.image_media_id).first())) {
    errors.push('The image is no longer in the media library. Choose another.');
    values.image_media_id = '';
  }

  // Without a typed slug, the title makes one; repeating events with the same title get their date added.
  const id = existing?.id ?? crypto.randomUUID();
  const slugTaken = (slug: string) => env.DB.prepare('SELECT 1 FROM events WHERE slug = ? AND id != ?').bind(slug, id).first();
  if (!errors.length) {
    if (typedSlug) {
      if (await slugTaken(typedSlug)) errors.push('Another event already uses that URL slug.');
    } else {
      const base = sanitizeSlug(values.title);
      values.slug = await slugTaken(base) ? sanitizeSlug(`${base.slice(0, 108)}-${values.starts_on}`) : base;
      if (!values.slug || await slugTaken(values.slug)) errors.push('Another event already uses this title and date. Enter a URL slug.');
    }
  }
  if (errors.length) return { ok: false, values: { ...values, slug: typedSlug }, errors };

  const now = Date.now();
  // The audit entries share the save's batch, so an event never changes without a record of who changed it.
  await env.DB.batch([env.DB.prepare(`
    INSERT INTO events (id, slug, title, summary, description, category, starts_on, start_time, ends_on, end_time,
      venue, address, community, organizer, cost, link, image_media_id, status, created_at, updated_at, hours_note,
      performer, performer_type, ticket_price, ticket_url, ticket_availability, organizer_url)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug, title = excluded.title, summary = excluded.summary, description = excluded.description,
      category = excluded.category, starts_on = excluded.starts_on, start_time = excluded.start_time, ends_on = excluded.ends_on,
      end_time = excluded.end_time, venue = excluded.venue, address = excluded.address, community = excluded.community,
      organizer = excluded.organizer, cost = excluded.cost, link = excluded.link, image_media_id = excluded.image_media_id,
      status = excluded.status, updated_at = excluded.updated_at, hours_note = excluded.hours_note,
      performer = excluded.performer, performer_type = excluded.performer_type, ticket_price = excluded.ticket_price,
      ticket_url = excluded.ticket_url, ticket_availability = excluded.ticket_availability, organizer_url = excluded.organizer_url
  `).bind(id, values.slug, values.title, values.summary, values.description, values.category, values.starts_on,
    values.start_time || null, values.ends_on || null, (values.start_time && values.end_time) || null,
    values.venue, values.address, values.community, values.organizer, values.cost, values.link,
    values.image_media_id || null, values.status, now, values.hours_note,
    values.performer, values.performer_type, values.ticket_price, values.ticket_url, values.ticket_availability, values.organizer_url), ...eventAudit(actor, id, values, existing)]);
  if (values.status !== 'draft') await ensureEventThread({ id, title: values.title, summary: values.summary });
  return { ok: true, id };
}
