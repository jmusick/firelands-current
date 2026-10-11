import { env } from 'cloudflare:workers';

/**
 * Authentication security events as structured console lines, read in Workers Logs (the `observability`
 * block in wrangler.jsonc). They are not stored in D1: sign-in noise is high-volume and short-lived, the
 * audit log (src/lib/audit.ts) is for staff decisions that need to be kept, and a log line costs no write
 * on the sign-in path. Each line is one JSON object:
 *
 *   {"event":"auth_event","type":"sign_in","outcome":"failure","status":401,"code":"INVALID_EMAIL_OR_PASSWORD","account":"9f2c…","client":"41ab…"}
 *
 * What is never in a line: passwords, tokens, reset or verification links, cookies, session ids, and the
 * email address or IP address themselves. `account` and `client` are keyed hashes of them (HMAC with
 * BETTER_AUTH_SECRET), so repeated failures against one address or from one network can be counted and
 * correlated without the log being a list of who tried to sign in. `user` is the opaque account id, only
 * when the request already belonged to a signed-in account. Rotating BETTER_AUTH_SECRET changes the hashes.
 */

/** Better Auth endpoints that matter for account security, and the name each event goes by. */
export const AUTH_EVENT_TYPES: Record<string, string> = {
  '/sign-in/email': 'sign_in',
  '/sign-up/email': 'sign_up',
  '/sign-out': 'sign_out',
  '/request-password-reset': 'password_reset_request',
  '/reset-password': 'password_reset',
  '/change-password': 'password_change',
  '/change-email': 'email_change_request',
  '/send-verification-email': 'verification_resend',
  '/verify-email': 'email_verify',
  '/link-social': 'link_account',
  '/unlink-account': 'unlink_account',
  '/delete-user': 'account_delete',
  '/revoke-session': 'session_revoke',
  '/revoke-sessions': 'sessions_revoke_all',
  '/revoke-other-sessions': 'sessions_revoke_others',
};

/** A short keyed hash of `value`, stable for one secret, safe to log. */
export async function fingerprint(kind: 'email' | 'ip', value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`auth-log:${kind}:${value.trim().toLowerCase()}`));
  return [...new Uint8Array(mac).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type EventFields = { type: string; outcome: 'success' | 'failure'; status?: number; code?: string; user?: string; email?: string; ip?: string | null };

async function emit(fields: EventFields): Promise<void> {
  const { email, ip, ...rest } = fields;
  const line = { event: 'auth_event', ...rest, ...(email ? { account: await fingerprint('email', email) } : {}), ...(ip ? { client: await fingerprint('ip', ip) } : {}) };
  (fields.outcome === 'failure' ? console.warn : console.log)(JSON.stringify(line));
}

// The fields of a Better Auth hook context this module reads.
type HookContext = {
  path?: string;
  body?: unknown;
  headers?: Headers;
  request?: Request;
  context: { returned?: unknown; newSession?: { user: { id: string } } | null; session?: { user: { id: string } } | null };
};

const emailIn = (body: unknown) => (body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string' ? (body as { email: string }).email : undefined);
const clientIp = (headers: Headers | undefined) => headers?.get('cf-connecting-ip') ?? null;

/**
 * Better Auth's `hooks.after`: a request the endpoint accepted. Failures come from `handleAuthRequest`,
 * which also sees the ones a `before` hook or plugin refuses (CAPTCHA, stale confirmation, weak password),
 * and these hooks never run for.
 */
export async function recordAuthSuccess(ctx: HookContext): Promise<void> {
  try {
    const type = ctx.path ? AUTH_EVENT_TYPES[ctx.path] : undefined;
    const returned = ctx.context.returned;
    const refused = returned instanceof Error || (typeof returned === 'object' && returned !== null && 'statusCode' in returned);
    if (refused) return;
    const returnedUser = (returned as { user?: { id?: unknown } } | null)?.user?.id;
    const user = ctx.context.newSession?.user.id ?? ctx.context.session?.user.id ?? (typeof returnedUser === 'string' ? returnedUser : undefined);
    if (type) await emit({ type, outcome: 'success', user, email: emailIn(ctx.body), ip: clientIp(ctx.headers ?? ctx.request?.headers) });
    // A finished sign-in with another provider (the callback has no fixed path to list above).
    else if (ctx.path?.startsWith('/callback/') && ctx.context.newSession) await emit({ type: 'social_sign_in', outcome: 'success', user: ctx.context.newSession.user.id, ip: clientIp(ctx.headers ?? ctx.request?.headers) });
  } catch {
    console.error(JSON.stringify({ event: 'auth_event_failed' }));
  }
}

/** The most of a request body read for the email fingerprint; sign-in forms are far smaller. */
const MAX_BODY_BYTES = 4096;

/** The JSON in a request body, or null if it is larger than the limit (counted as it streams), unreadable, or not JSON. */
async function readSmallJson(body: ReadableStream<Uint8Array> | null): Promise<unknown> {
  const reader = body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Runs Better Auth's handler and logs a refused request on a security-relevant endpoint: sign-in that
 * didn't work, a throttled client (429), a refused CAPTCHA, a stale password confirmation. The response is
 * returned untouched, and a logging problem never changes it.
 */
export async function handleAuthRequest(handler: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
  const copy = request.method === 'POST' ? request.clone() : null;
  const response = await handler(request);
  if (!copy || response.status < 400) {
    // Release the unread clone so the runtime doesn't keep buffering a body nothing will read.
    copy?.body?.cancel().catch(() => {});
    return response;
  }
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, '');
    const type = AUTH_EVENT_TYPES[path];
    if (!type) return response;
    const email = emailIn(await readSmallJson(copy.body));
    const body = await response.clone().json().catch(() => null) as { code?: unknown } | null;
    await emit({
      type,
      outcome: 'failure',
      status: response.status,
      // Better Auth's own error code; the throttle answers 429 without one.
      code: typeof body?.code === 'string' ? body.code.slice(0, 64) : response.status === 429 ? 'RATE_LIMITED' : undefined,
      email,
      ip: clientIp(request.headers),
    });
  } catch {
    console.error(JSON.stringify({ event: 'auth_event_failed' }));
  }
  return response;
}
