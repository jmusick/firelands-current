/** Headers every response carries. Add site-wide security headers here. */
export function applySecurityHeaders(headers: Headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  // Browsers ignore HSTS over plain HTTP, so local development is unaffected. No includeSubDomains or
  // preload: only the apex and www (which redirects to it) are known to serve HTTPS.
  headers.set('Strict-Transport-Security', 'max-age=31536000');
}

/**
 * The Content Security Policy is on trial: browsers report violations to `/api/csp-report` but block
 * nothing. Set this to true to enforce it once the reports are clean (see README, "Content Security Policy").
 */
export const CSP_ENFORCE = false;
export const CSP_REPORT_PATH = '/api/csp-report';
const CSP_REPORT_GROUP = 'csp';

/** 128 random bits, base64, new for every response. */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The policy for HTML pages. Scripts run only with this response's nonce: `is:inline` scripts carry
 * `nonce={Astro.locals.cspNonce}`, the middleware adds it to Astro's bundled `/_astro/*.js` modules, and
 * 'strict-dynamic' extends trust to what those load (Turnstile's api.js, gtag's own scripts), so no
 * script host allowlist is needed. Images, fonts, and connections still name each third party:
 * Google Analytics and Fonts, Cloudflare Web Analytics, and the Turnstile frame.
 */
export function contentSecurityPolicy(nonce: string, { dev = false } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    // Vite injects component styles as <style> elements in development; production links /_astro/*.css.
    `style-src 'self' https://fonts.googleapis.com${dev ? " 'unsafe-inline'" : ''}`,
    // Templates set layout and ad colors in style attributes. CSS there can't run script, and img-src
    // and connect-src below limit where it could send anything.
    "style-src-attr 'unsafe-inline'",
    // blob: shows a chosen file before it uploads to the media library.
    "img-src 'self' blob: https://*.google-analytics.com https://*.googletagmanager.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://cloudflareinsights.com${dev ? ' ws:' : ''}`,
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'",
    "base-uri 'none'",
    // Every form posts to this site; social sign-in navigates to the provider from script, not a form.
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join('; ');
}

/**
 * Sets the policy (enforced or report-only, per CSP_ENFORCE) and the endpoint that `report-to` names,
 * as an absolute URL on the page's own origin.
 */
export function applyContentSecurityPolicy(headers: Headers, nonce: string, { origin, dev = false }: { origin: string; dev?: boolean }) {
  headers.set(CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', contentSecurityPolicy(nonce, { dev }));
  headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${new URL(CSP_REPORT_PATH, origin).href}"`);
}

/**
 * Script URLs the middleware may give the nonce to: Astro's hashed bundles only, a single path segment
 * so nothing can climb out of /_astro/. Injected markup pointing here could only run our own bundles.
 * In development Vite serves modules from many same-origin paths instead.
 */
export function isBundledScript(src: string | null, { dev = false } = {}): boolean {
  if (!src) return false;
  return dev ? /^\/(?!\/)/.test(src) : /^\/_astro\/[\w.-]+\.js$/.test(src);
}

export const isHtml = (headers: Headers) => (headers.get('Content-Type') ?? '').toLowerCase().includes('text/html');

export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/**
 * Personal pages, staff tools, every API result (including Better Auth's), and the auth forms, whose
 * HTML can carry a password-reset token or a return address.
 */
const PRIVATE_PATHS = ['/account', '/admin', '/business', '/api', '/sign-in', '/register', '/forgot-password', '/reset-password', '/reauth'];

export const isPrivatePath = (pathname: string) =>
  PRIVATE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * Keeps private and personalized responses out of shared caches: private paths, anything that sets a
 * cookie, and anything rendered for a signed-in reader except non-HTML that chose its own caching
 * (media and feeds look the same to everyone). An explicit no-store is kept; any other explicit value
 * on a private response is replaced, since `public` or `max-age` there could cache one reader's page
 * for another. Anonymous public pages are left alone; Cloudflare doesn't cache HTML by default.
 */
export function applyCachePolicy(headers: Headers, { pathname, signedIn }: { pathname: string; signedIn: boolean }) {
  const current = headers.get('Cache-Control');
  const html = isHtml(headers);
  const personal = isPrivatePath(pathname) || headers.getSetCookie().length > 0 || (signedIn && (html || !current));
  if (!personal || (current && /(^|,)\s*no-store\s*(,|$)/i.test(current))) return;
  headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
}
