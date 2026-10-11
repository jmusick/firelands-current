// Rules for choosing a password, along the lines of NIST SP 800-63B-4: a 12-character minimum (the publisher
// kept 12 rather than NIST's 15 for password-only accounts), a generous maximum, no composition rules (no
// "must include a symbol"), no forced rotation, and a local blocklist of values attackers already try. Applies
// only when a password is chosen (sign-up, reset, change, admin-set); signing in never re-checks it.
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

export type PasswordProblem = 'length' | 'predictable';

export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A phrase of several words works well. Passwords that are easy to guess are refused.`;

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  length: `Passwords must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
  predictable: 'That password is too easy to guess: it repeats itself, follows a keyboard or number sequence, or is built from your name, email address, or this site’s name. Choose a longer, less predictable one.',
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

/** The first rule a chosen password breaks, or null when it may be used. */
export async function passwordProblem(password: string, who: { email?: string; name?: string } = {}): Promise<PasswordProblem | null> {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return 'length';
  if (isPredictable(password, who)) return 'predictable';
  return null;
}
