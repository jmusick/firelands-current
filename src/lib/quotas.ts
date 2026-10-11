import { env } from 'cloudflare:workers';
import { consumeRateWindow } from './auth-rate-limit';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export type Quota = { max: number; windowMs: number };

/**
 * Per-client allowances for public writes. A window may not exceed RATE_LIMIT_RETENTION_MS, or the
 * scheduled prune would delete a counter that is still in force.
 *
 * `inbox`, `corrections`, `vote`, and `reauth` are counted in D1 by `takeQuota`. `thread`, `reply`, and `report` are
 * enforced inside the INSERT that stores the row (see the Talk endpoints), because a forum limit must hold
 * for concurrent requests, so they count the author's rows instead.
 */
export const QUOTAS = {
  // Contact, Submit news, and Advertise share one allowance: they all send mail to staff.
  inbox: { max: 10, windowMs: HOUR },
  // A reader may reasonably flag several errors in one sitting.
  corrections: { max: 10, windowMs: HOUR },
  // Voting is one click, and switching or taking back a vote counts too.
  vote: { max: 60, windowMs: MINUTE },
  thread: { max: 5, windowMs: HOUR },
  reply: { max: 3, windowMs: MINUTE },
  report: { max: 10, windowMs: HOUR },
  // Password confirmations for privileged actions: ordinary slips fit, guessing from a borrowed session does not.
  reauth: { max: 5, windowMs: 10 * MINUTE },
} as const satisfies Record<string, Quota>;

export type CountedQuota = 'inbox' | 'corrections' | 'vote' | 'reauth';

/** Collapses an IPv6 address to its /64 network, as Better Auth does, so a visitor can't dodge a limit by rotating through a /64. */
export function normalizeIp(ip: string): string {
  const address = ip.trim().toLowerCase();
  if (!address.includes(':')) return address;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = address.split('::');
  const first = head ? head.split(':') : [];
  const last = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? first : [...first, ...Array(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last];
  return groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':');
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey('raw', new TextEncoder().encode(`quota:${env.BETTER_AUTH_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return keyPromise;
}

/**
 * Who a quota counts against: the signed-in account, otherwise the connecting address. Cloudflare sets
 * CF-Connecting-IP and replaces any copy the client sent. The address is stored only as a keyed hash, so
 * the counter table doesn't hold raw visitor IPs for these forms.
 */
export async function quotaClient(request: Request, userId: string | null | undefined): Promise<string> {
  if (userId) return `u:${userId}`;
  const ip = normalizeIp(request.headers.get('CF-Connecting-IP') ?? 'unknown');
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(ip)));
  return `ip:${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Spends one use of a client's allowance. Returns null when the request may proceed, or the seconds until
 * the window ends when it is over the limit. Refused requests still count but never move the window, so a
 * client that keeps retrying is released when the window ends. The count is one atomic upsert shared by
 * every Worker isolate.
 *
 * If the counter can't be read the request is allowed and the failure is logged: these forms already sit
 * behind a human check, and a database hiccup shouldn't discard a news tip.
 */
export async function takeQuota(name: CountedQuota, request: Request, userId?: string | null): Promise<number | null> {
  const { max, windowMs } = QUOTAS[name];
  try {
    const now = Date.now();
    const row = await consumeRateWindow(env.DB, `quota:${name}:${await quotaClient(request, userId)}`, windowMs, now);
    return row.count <= max ? null : Math.max(1, Math.ceil((row.windowStart + windowMs - now) / 1000));
  } catch {
    console.error(JSON.stringify({ event: 'quota_unavailable', quota: name }));
    return null;
  }
}

export function quotaResponse(retryAfter: number): Response {
  return new Response('Too many requests. Please try again later.', {
    status: 429,
    headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
