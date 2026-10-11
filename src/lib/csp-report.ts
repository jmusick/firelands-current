/** Chrome batches several reports into one delivery; anything larger is not a browser's report. */
export const CSP_REPORT_BYTES = 32 * 1024;
/** `report-uri` deliveries, Reporting API (`report-to`) batches, and older browsers' plain JSON. */
export const CSP_REPORT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];
const MAX_REPORTS = 20;
const MAX_PATH = 200;

export interface Violation {
  directive: string;
  /** A keyword such as `inline` or `eval`, an origin, or a bare scheme such as `data:`; never a path or query. */
  blocked: string;
  /** The page's path on this site, without its query or fragment. */
  page: string;
  disposition: 'enforce' | 'report' | 'unknown';
}

const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'data', 'blob', 'trusted-types-policy', 'trusted-types-sink']);

function blockedSource(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'unknown';
  if (KEYWORDS.has(value)) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url.origin : url.protocol;
  } catch {
    return 'other';
  }
}

function pagePath(value: unknown, siteOrigin: string): string {
  if (typeof value !== 'string') return 'unknown';
  try {
    const url = new URL(value);
    return url.origin === siteOrigin ? url.pathname.slice(0, MAX_PATH) : 'other-origin';
  } catch {
    return 'unknown';
  }
}

function summarize(report: Record<string, unknown>, siteOrigin: string): Violation {
  // `violated-directive` from older browsers can carry the directive's sources; only its name is kept.
  const name = String(report.effectiveDirective ?? report['effective-directive'] ?? report['violated-directive'] ?? '').split(' ')[0];
  const disposition = report.disposition;
  return {
    directive: /^[a-z-]{1,40}$/.test(name) ? name : 'unknown',
    blocked: blockedSource(report.blockedURL ?? report['blocked-uri']),
    page: pagePath(report.documentURL ?? report['document-uri'], siteOrigin),
    disposition: disposition === 'enforce' || disposition === 'report' ? disposition : 'unknown',
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The violations in a delivery, reduced to what the operator needs to adjust the policy. Script
 * samples, source files, referrers, full URLs, policy text, and the reporting browser are dropped.
 */
export function violations(payload: unknown, siteOrigin: string): Violation[] {
  const reports = isObject(payload) && isObject(payload['csp-report'])
    ? [payload['csp-report']]
    : Array.isArray(payload)
      ? payload.filter((item) => isObject(item) && item.type === 'csp-violation' && isObject(item.body)).map((item) => item.body as Record<string, unknown>)
      : [];
  return reports.slice(0, MAX_REPORTS).map((report) => summarize(report, siteOrigin));
}

/**
 * Bounds log volume per Worker isolate: each distinct violation is logged at most once per
 * `repeatMs`, and no more than `perMinute` lines go out in any minute, whatever the browsers send.
 */
export function createLogLimiter({ repeatMs = 10 * 60_000, perMinute = 60, maxKeys = 1000 } = {}) {
  const lastLogged = new Map<string, number>();
  let minute = 0;
  let count = 0;
  return (violation: Violation, now = Date.now()): boolean => {
    if (now - minute >= 60_000) { minute = now; count = 0; }
    if (count >= perMinute) return false;
    const key = `${violation.directive} ${violation.blocked} ${violation.page} ${violation.disposition}`;
    const previous = lastLogged.get(key);
    if (previous !== undefined && now - previous < repeatMs) return false;
    if (lastLogged.size >= maxKeys) lastLogged.clear();
    lastLogged.set(key, now);
    count++;
    return true;
  };
}
