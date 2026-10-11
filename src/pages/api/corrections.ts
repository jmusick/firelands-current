import { readForm } from '../../lib/request-body';
import type { APIRoute } from 'astro';
import { correctionKind, correctionTarget, createCorrection } from '../../lib/corrections';
import { invalidFieldsQuery } from '../../lib/form-errors';
import { cleanText, sameOrigin } from '../../lib/forum';
import { sendToInbox, verifyTurnstile } from '../../lib/inbox';

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!sameOrigin(request)) return new Response('Invalid request origin', { status: 403 });

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const kind = correctionKind(cleanText(form.get('type')));
  const slug = cleanText(form.get('slug'));
  if (!kind || !/^[a-z0-9-]{1,120}$/.test(slug)) return new Response('Unknown story or event', { status: 400 });
  const page = `/report-inaccuracy?type=${kind}&slug=${slug}`;
  const back = (param: string) => Response.redirect(new URL(`${page}&${param}`, request.url), 303);

  // Hidden field real visitors never fill in; pretend success so bots learn nothing.
  if (cleanText(form.get('website'))) return back('sent=1');

  const humanCheck = await verifyTurnstile(cleanText(form.get('cf-turnstile-response')), request.headers.get('CF-Connecting-IP'), 'corrections');
  if (humanCheck !== 'passed') return back(humanCheck === 'unavailable' ? 'error=captcha_unavailable' : 'error=captcha');

  const name = cleanText(form.get('name')).replace(/[\r\n]+/g, ' ');
  const email = cleanText(form.get('email'));
  const details = cleanText(form.get('details'));
  const suggestedFix = cleanText(form.get('suggested_fix'));
  const sourceUrl = cleanText(form.get('source_url'));
  const sourceOk = sourceUrl === '' || (sourceUrl.length <= 500 && /^https?:\/\/[^\s]+$/i.test(sourceUrl));
  const invalid = [
    ...(!name || name.length > 100 ? ['name'] : []),
    ...(email.length > 200 || !EMAIL.test(email) ? ['email'] : []),
    ...(details.length < 10 || details.length > 5000 ? ['details'] : []),
    ...(suggestedFix.length > 2000 ? ['suggested_fix'] : []),
    ...(!sourceOk ? ['source_url'] : []),
  ];
  if (invalid.length) return back(invalidFieldsQuery(invalid));

  const target = await correctionTarget(kind, slug);
  if (!target) return new Response('Story or event not found', { status: 404 });

  const id = await createCorrection({ kind, targetId: target.id, title: target.title, slug: target.slug, userId: locals.user?.id ?? null,
    name, email, details, suggestedFix, sourceUrl });
  try {
    await sendToInbox('corrections', {
      name, email, subject: target.title.replace(/[\r\n]+/g, ' '),
      body: [`About: ${new URL(target.path, request.url).href}`, '', details,
        ...(suggestedFix ? ['', `Suggested fix: ${suggestedFix}`] : []),
        ...(sourceUrl ? ['', `Source: ${sourceUrl}`] : []),
        '', `Review: ${new URL(`/admin/corrections/${id}`, request.url).href}`].join('\n'),
    });
  } catch {
    // The report is safely stored in D1 even if the notification email fails.
    console.error('correction notification failed');
  }
  return back('sent=1');
};
