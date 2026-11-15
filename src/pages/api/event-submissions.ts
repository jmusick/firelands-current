import { readForm } from '../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { validateEventSubmission } from '../../lib/event-submissions';
import { invalidFieldsQuery } from '../../lib/form-errors';
import { cleanText, sameOrigin } from '../../lib/forum';
import { sendToInbox, verifyTurnstile } from '../../lib/inbox';
import { takeQuota } from '../../lib/quotas';

const FORM = '/submit-event';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const back = (param: string) => Response.redirect(new URL(`${FORM}?${param}`, request.url), 303);

  // Hidden field real visitors never fill in; pretend success so bots learn nothing.
  if (cleanText(form.get('website'))) return back('sent=1');

  const humanCheck = await verifyTurnstile(cleanText(form.get('cf-turnstile-response')), request.headers.get('CF-Connecting-IP'), 'event-submission');
  if (humanCheck !== 'passed') return back(humanCheck === 'unavailable' ? 'error=captcha_unavailable' : 'error=captcha');

  const result = validateEventSubmission(form);
  if (!result.ok) return back(invalidFieldsQuery(result.invalid));
  const s = result.submission;

  // Back to the form rather than a bare 429 page, so the organizer's draft is restored with the explanation.
  if (await takeQuota('event', request, locals.user?.id) !== null) return back('error=rate');

  // A submission is only ever stored in event_submissions; events stay staff-made until an editor converts one.
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO event_submissions
    (id, title, summary, description, category, starts_on, start_time, ends_on, end_time, venue, address, community, organizer, cost, link,
     name, email, note, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?)`)
    .bind(id, s.title, s.summary, s.description, s.category, s.starts_on, s.start_time, s.ends_on, s.end_time, s.venue, s.address, s.community,
      s.organizer, s.cost, s.link, s.name, s.email, s.note, now, now).run();
  try {
    // The subject carries the event title only; the organizer's contact details are in Reply-To and the review page.
    await sendToInbox('events', {
      name: s.name, email: s.email, subject: s.title,
      body: `A new event was submitted for review.\n\nReview: ${new URL(`/admin/events/submissions/${id}`, request.url).href}`,
    });
  } catch {
    // The submission is safely stored in D1 even if the notification email fails.
    console.error('event submission notification failed');
  }
  // o=1 (unlike the honeypot's plain sent=1) marks a real accepted submission so the page can report it to
  // analytics once (src/scripts/outcome-events.ts).
  return back('sent=1&o=1');
};
