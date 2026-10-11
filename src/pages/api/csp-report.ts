import type { APIRoute } from 'astro';
import { createLogLimiter, CSP_REPORT_BYTES, CSP_REPORT_TYPES, violations } from '../../lib/csp-report';
import { readText } from '../../lib/request-body';

const shouldLog = createLogLimiter();

// Content Security Policy violation reports from browsers. Nothing is stored; each distinct violation
// is written to the Worker log, redacted, for the operator to review.
export const POST: APIRoute = async ({ request }) => {
  const site = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  // Some browsers send reports with an opaque ("null") origin; another site's pages are refused.
  const foreign = origin !== null && origin !== 'null' && origin !== site;
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (foreign || !CSP_REPORT_TYPES.includes(type)) {
    await request.body?.cancel().catch(() => {});
    return new Response(null, { status: foreign ? 403 : 415 });
  }

  const text = await readText(request, CSP_REPORT_BYTES);
  if (text instanceof Response) return new Response(null, { status: text.status });
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }

  for (const violation of violations(payload, site)) {
    if (shouldLog(violation)) console.warn(JSON.stringify({ event: 'csp_violation', ...violation }));
  }
  return new Response(null, { status: 204 });
};
