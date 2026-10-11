/** Headers every response carries. Add site-wide security headers here. */
export function applySecurityHeaders(headers: Headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  // Browsers ignore HSTS over plain HTTP, so local development is unaffected. No includeSubDomains or
  // preload: only the apex and www (which redirects to it) are known to serve HTTPS.
  headers.set('Strict-Transport-Security', 'max-age=31536000');
}

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
  const html = (headers.get('Content-Type') ?? '').toLowerCase().includes('text/html');
  const personal = isPrivatePath(pathname) || headers.getSetCookie().length > 0 || (signedIn && (html || !current));
  if (!personal || (current && /(^|,)\s*no-store\s*(,|$)/i.test(current))) return;
  headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
}
