import { readForm } from '../../lib/request-body';
import type { APIRoute } from 'astro';
import { cleanText, sameOrigin } from '../../lib/forum';
import { invalidFieldsQuery } from '../../lib/form-errors';
import { INBOXES, isInboxKind, sendToInbox, verifyTurnstile } from '../../lib/inbox';
import { takeQuota } from '../../lib/quotas';
import { env } from 'cloudflare:workers';

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const kind = cleanText(form.get('kind'));
  if (!isInboxKind(kind)) return new Response('Unknown form', { status: 400 });
  const back = (param: string) => Response.redirect(new URL(`${INBOXES[kind].path}?${param}`, request.url), 303);

  // Hidden field real visitors never fill in; pretend success so bots learn nothing.
  if (cleanText(form.get('website'))) return back('sent=1');

  const humanCheck = await verifyTurnstile(cleanText(form.get('cf-turnstile-response')), request.headers.get('CF-Connecting-IP'), 'inbox');
  if (humanCheck !== 'passed') return back(humanCheck === 'unavailable' ? 'error=captcha_unavailable' : 'error=captcha');

  const name = cleanText(form.get('name'));
  const email = cleanText(form.get('email'));
  const subject = cleanText(form.get('subject')).replace(/[\r\n]+/g, ' ');
  const body = cleanText(form.get('body'));
  const invalid = [
    ...(!name || name.length > 100 ? ['name'] : []),
    ...(email.length > 200 || !EMAIL.test(email) ? ['email'] : []),
    ...(subject.length < 3 || subject.length > 120 ? ['subject'] : []),
    ...(body.length < 20 || body.length > 10000 ? ['body'] : []),
  ];
  if (invalid.length) return back(invalidFieldsQuery(invalid));

  // Back to the form rather than a bare 429 page, so the reader's draft is restored with the explanation.
  if (await takeQuota('inbox', request, locals.user?.id) !== null) return back('error=rate');

  const senderName = name.replace(/[\r\n]+/g, ' ');
  if (kind === 'news') {
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO news_submissions
      (id, submitter_user_id, name, email, subject, body, credit_requested, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?)`)
      .bind(crypto.randomUUID(), locals.user?.id ?? null, senderName, email, subject, body, form.get('credit_requested') === '1' ? 1 : 0, now, now).run();
  }
  try {
    await sendToInbox(kind, { name: senderName, email, subject, body });
  } catch {
    // The news tip is safely stored in D1 even if the notification email fails.
    console.error('inbox send failed', kind);
    if (kind !== 'news') return back('error=send');
  }
  return back('sent=1');
};
