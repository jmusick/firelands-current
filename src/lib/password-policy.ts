// Rules for choosing a password, following NIST SP 800-63B-4 for a password that is the only sign-in factor:
// a 15-character minimum, a generous maximum, no composition rules (no "must include a symbol") and no
// forced rotation, and a blocklist of values attackers already try. Applies only when a password is
// chosen (sign-up, reset, change, admin-set); signing in never re-checks it, so existing passwords keep working.
export const MIN_PASSWORD = 15;
export const MAX_PASSWORD = 128;

export type PasswordProblem = 'length' | 'predictable' | 'breached';

export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A phrase of several words works well. Passwords that are easy to guess or that appear in known data breaches are refused.`;

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  length: `Passwords must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
  predictable: 'That password is too easy to guess: it repeats itself, follows a keyboard or number sequence, or is built from your name, email address, or this site’s name. Choose a longer, less predictable one.',
  breached: 'That password appears in a published data breach, so attackers already try it. Choose a different one.',
};

const SEQUENCES = ['0123456789'.repeat(3), 'abcdefghijklmnopqrstuvwxyz'.repeat(2), 'qwertyuiopasdfghjklzxcvbnm'.repeat(2), 'zaqxswcdevfrbgtnhymjukilop'.repeat(2)];
// Words that tell an attacker nothing about the person but everything about the site, and the most common
// base words people build a password around.
const CONTEXT_WORDS = ['firelandscurrent', 'firelands', 'sandusky', 'newspaper', 'password', 'passw0rd', 'letmein', 'welcome', 'qwerty', 'iloveyou', 'admin'];
// What must be left of a password once the words above are taken out for it to count as more than those words.
const MIN_REMAINDER = 8;

const squash = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Local checks for passwords that long enough to pass the length rule are still trivial: one repeated
 * character or short pattern, a run along the keyboard or the digits, or little more than the site name,
 * the person's own name or email address, or "password" plus a few digits.
 */
export function isPredictable(password: string, who: { email?: string; name?: string } = {}): boolean {
  const flat = squash(password);
  if (!flat) return true;
  if (new Set(flat).size <= 3 || /^(.{1,4})\1+$/u.test(flat)) return true;
  if (flat.length >= 8 && SEQUENCES.some((run) => run.includes(flat) || [...run].reverse().join('').includes(flat))) return true;

  const words = [...CONTEXT_WORDS];
  const local = squash((who.email ?? '').split('@')[0] ?? '');
  if (local.length >= 4) words.push(local);
  for (const part of (who.name ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (part.length >= 4) words.push(part);
  let rest = flat;
  for (const word of words.sort((a, b) => b.length - a.length)) rest = rest.split(word).join('');
  return rest.length < MIN_REMAINDER;
}

/**
 * Whether the password is in the Have I Been Pwned corpus (billions of passwords from past breaches),
 * checked with its k-anonymity range API: only the first five characters of the password's SHA-1 hash leave
 * the Worker, and the reply is padded so its size reveals nothing either. The password, its full hash, and
 * the account are never sent. Returns null when the service can't be reached: a breach-corpus outage must
 * not stop people from registering or recovering an account, so the check is skipped and logged.
 */
export async function isBreached(password: string): Promise<boolean | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const suffix = hash.slice(5);
    for (const line of (await response.text()).split(/\r?\n/)) {
      const [candidate, count] = line.trim().split(':');
      // Padding rows carry a count of zero.
      if (candidate?.toUpperCase() === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch (error) {
    console.error(JSON.stringify({ event: 'password_blocklist_unavailable', error: error instanceof Error ? error.name : 'unknown' }));
    return null;
  }
}

/** The first rule a chosen password breaks, or null when it may be used. */
export async function passwordProblem(password: string, who: { email?: string; name?: string } = {}): Promise<PasswordProblem | null> {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return 'length';
  if (isPredictable(password, who)) return 'predictable';
  if (await isBreached(password)) return 'breached';
  return null;
}
