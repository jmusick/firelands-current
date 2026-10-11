import { env } from 'cloudflare:workers';

/**
 * How long a proof of identity (typing the password, or finishing a provider sign-in) keeps privileged
 * actions open. Long enough to finish a run of admin work such as adding several accounts or fixing a
 * set of roles; short enough that a session left open on a shared computer, or a stolen cookie, stops
 * being enough for the changes that matter most within a quarter of an hour. The sign-in itself counts,
 * so a person who has just signed in is never asked twice.
 */
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;
export const REAUTH_WINDOW_MINUTES = REAUTH_WINDOW_MS / 60000;

/** Why a person was sent to /reauth, shown on that page. */
export const REAUTH_REASONS: Record<string, string> = {
  role: 'changing a staff role',
  create: 'adding an account',
  password: 'setting someone’s password',
  profile: 'changing someone’s email address',
  delete: 'deleting an account',
  link: 'linking a sign-in method',
  unlink: 'removing a sign-in method',
};

/** Records that this session just proved its owner's identity. */
export async function recordReauth(sessionId: string, now = Date.now()): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO session_reauth (session_id, reauthenticated_at) VALUES (?, ?)
    ON CONFLICT (session_id) DO UPDATE SET reauthenticated_at = excluded.reauthenticated_at
  `).bind(sessionId, now).run();
}

/** True when the session proved its owner's identity within the window. A session that never has is stale. */
export async function isFresh(sessionId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!sessionId) return false;
  const row = await env.DB.prepare('SELECT reauthenticated_at FROM session_reauth WHERE session_id = ?')
    .bind(sessionId).first<{ reauthenticated_at: number }>();
  return row !== null && now - row.reauthenticated_at < REAUTH_WINDOW_MS;
}

/**
 * A same-origin path to come back to, or the fallback. Browsers treat a backslash as a slash, so
 * "/\example.com" would leave the site; resolving against a placeholder origin and keeping only the path,
 * query, and hash catches that and any scheme-relative or absolute URL. Never points back at /reauth.
 */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || next.length > 2048 || !next.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = 'https://reauth.invalid';
    const url = new URL(next, base);
    if (url.origin !== base || url.pathname === '/reauth' || url.pathname.startsWith('/reauth/')) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** The /reauth address that returns to `next` once the person has confirmed their password. */
export function reauthPath(next: string, reason?: string): string {
  const params = new URLSearchParams({ next: safeNext(next) });
  if (reason && Object.hasOwn(REAUTH_REASONS, reason)) params.set('reason', reason);
  return `/reauth?${params}`;
}
