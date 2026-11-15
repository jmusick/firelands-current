import { env } from 'cloudflare:workers';

export const INBOXES = {
  news: { address: 'news@firelandscurrent.com', subject: 'News tip', path: '/submit-news' },
  contact: { address: 'contact@firelandscurrent.com', subject: 'Contact form', path: '/contact' },
  ads: { address: 'ads@firelandscurrent.com', subject: 'Advertising inquiry', path: '/advertise' },
  // Not a public form kind (see isInboxKind): only the corrections endpoint sends to it.
  corrections: { address: 'news@firelandscurrent.com', subject: 'Correction request', path: '/report-inaccuracy' },
  // Not a public form kind either: only the event submission endpoint sends to it.
  events: { address: 'news@firelandscurrent.com', subject: 'Event submission', path: '/submit-event' },
} as const;

export type InboxKind = keyof typeof INBOXES;

export function isInboxKind(value: string): value is InboxKind {
  return value === 'news' || value === 'contact' || value === 'ads';
}

// 'passed' lets the submission continue, 'rejected' means the visitor failed the check (or the token was
// solved somewhere else), and 'unavailable' means we could not get an answer from Cloudflare, so the visitor
// should simply try again. Only 'passed' ever lets a submission through.
export type TurnstileResult = 'passed' | 'rejected' | 'unavailable';

const TURNSTILE_TIMEOUT_MS = 4000;
// A real Turnstile token is at most 2048 characters.
const TURNSTILE_MAX_TOKEN = 2048;
// Cloudflare reports these when our request or secret is wrong or its service is failing, not when the visitor failed.
const TURNSTILE_SERVICE_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret', 'bad-request', 'internal-error']);

// `action` is the data-action the widget was rendered with. When TURNSTILE_EXPECTED_HOSTNAMES (comma-separated)
// is set, the response must also name one of those hostnames and the same action, so a token solved on another
// site or form cannot be replayed here. It is unset locally because Cloudflare's test keys report a fixed hostname.
export async function verifyTurnstile(token: string, ip: string | null, action?: string,
  options: { timeoutMs?: number } = {}): Promise<TurnstileResult> {
  if (!token || token.length > TURNSTILE_MAX_TOKEN) return 'rejected';
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  let result: { success?: unknown; hostname?: unknown; action?: unknown; 'error-codes'?: unknown } | null;
  try {
    // The signal also covers reading the body, so a stalled response cannot hold the request open.
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(options.timeoutMs ?? TURNSTILE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('turnstile siteverify failed', res.status);
      return 'unavailable';
    }
    result = await res.json();
  } catch (error) {
    console.error('turnstile siteverify unreachable', error instanceof Error ? error.name : 'unknown');
    return 'unavailable';
  }
  if (!result || typeof result !== 'object') return 'unavailable';

  if (result.success !== true) {
    const codes = Array.isArray(result['error-codes']) ? result['error-codes'].filter((c): c is string => typeof c === 'string') : [];
    if (codes.some((code) => TURNSTILE_SERVICE_ERRORS.has(code))) {
      console.error('turnstile siteverify error', codes.join(','));
      return 'unavailable';
    }
    return 'rejected';
  }

  const hostnames = (env.TURNSTILE_EXPECTED_HOSTNAMES ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (hostnames.length) {
    if (typeof result.hostname !== 'string' || !hostnames.includes(result.hostname.toLowerCase()) ||
        (action !== undefined && result.action !== action)) {
      console.error('turnstile hostname or action mismatch');
      return 'rejected';
    }
  }
  return 'passed';
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Sender must be on the onboarded domain; the visitor's address goes in Reply-To so
// staff can answer straight from their inbox.
export async function sendToInbox(kind: InboxKind, msg: { name: string; email: string; subject: string; body: string }) {
  const inbox = INBOXES[kind];
  const subject = `${inbox.subject}: ${msg.subject}`.slice(0, 200);
  const text = `From: ${msg.name} <${msg.email}>\n\n${msg.body}`;
  await env.EMAIL.send({
    to: inbox.address,
    from: { email: 'noreply@firelandscurrent.com', name: 'Firelands Current website' },
    replyTo: { email: msg.email, name: msg.name },
    subject,
    text,
    html: `<p><strong>From:</strong> ${escapeHtml(msg.name)} &lt;${escapeHtml(msg.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(msg.body)}</p>`,
  });
}
