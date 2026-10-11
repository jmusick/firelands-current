import { defineMiddleware } from 'astro:middleware';
import { createAuth } from './lib/auth';
import { applyCachePolicy, applyContentSecurityPolicy, applySecurityHeaders, createNonce, CSP_REPORT_PATH, isBundledScript, isHtml } from './lib/response-headers';
import { getMemberStatus } from './lib/staff';

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.hostname === 'www.firelandscurrent.com') {
    const canonical = new URL(context.request.url);
    canonical.hostname = 'firelandscurrent.com';
    return Response.redirect(canonical, 308);
  }

  context.locals.user = null;
  context.locals.session = null;
  context.locals.staffRole = null;
  const nonce = createNonce();
  context.locals.cspNonce = nonce;

  // Set-Cookie headers from a sliding session refresh; without them the browser
  // cookie expires on its original date even though the session was extended.
  let refreshedCookies: string[] = [];
  // Violation reports need no account, so they cost no session lookup.
  if (!context.url.pathname.startsWith('/api/auth/') && context.url.pathname !== CSP_REPORT_PATH) {
    const { headers, response: current } = await createAuth().api.getSession({ headers: context.request.headers, returnHeaders: true });
    refreshedCookies = headers.getSetCookie();
    // Suspending an account deletes its sessions; this also covers a session created in the gap.
    const status = current?.user ? await getMemberStatus(current.user.id) : null;
    if (current && status && !status.suspended) {
      context.locals.user = current.user;
      context.locals.session = current.session;
      context.locals.staffRole = status.role;
    }
  }

  // Redirect responses have immutable headers in the Workers runtime.
  const upstream = await next();
  const response = new Response(upstream.body, upstream);
  for (const cookie of refreshedCookies) response.headers.append('Set-Cookie', cookie);
  applySecurityHeaders(response.headers);
  // After the cookies, so a refreshed session also marks the response private.
  applyCachePolicy(response.headers, { pathname: context.url.pathname, signedIn: context.locals.user !== null });
  if (!isHtml(response.headers) || !response.body) return response;

  const dev = import.meta.env.DEV;
  applyContentSecurityPolicy(response.headers, nonce, { origin: context.url.origin, dev });
  // Astro gives no way to put attributes on the scripts it bundles, so the nonce is added here, only to
  // script elements that load our own bundles; inline scripts get it in their templates.
  return new HTMLRewriter().on('script[src]', {
    element(script) {
      if (!script.hasAttribute('nonce') && isBundledScript(script.getAttribute('src'), { dev })) script.setAttribute('nonce', nonce);
    },
  }).transform(response);
});
