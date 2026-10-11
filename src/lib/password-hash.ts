import { env } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The one password hashing implementation: Better Auth uses it for sign-up, sign-in, change and reset
 * (emailAndPassword.password in auth.ts), and the admin Add user, Set password and /reauth paths use it
 * directly (users.ts).
 *
 * New hashes are self-describing PHC strings, `$scrypt$ln=14,r=8,p=2$<salt>$<key>` (unpadded base64), so
 * the profile can be raised later without a migration: anything not on CURRENT is replaced the next time
 * its owner types the password (upgradePasswordHash). Hashes Better Auth wrote before this
 * (`<hex salt>:<hex key>`, scrypt N=2^14 r=16 p=1) still verify and are upgraded the same way.
 *
 * CURRENT (N=2^14, r=8, p=2) does the same CPU work as the legacy hash (2^14·16·1 = 2^14·8·2) in half the
 * memory. The site runs on the Workers Free plan, whose 10 ms CPU budget even the legacy hash exceeds, so the
 * work factor is held where it was rather than raised to OWASP's profiles; the README's "Password hashing"
 * section has the measured costs. Because legacy and CURRENT checks cost the same, sign-in timing doesn't
 * tell which accounts haven't signed in since the format change.
 */
export const CURRENT = { ln: 14, r: 8, p: 2 } as const;
const LEGACY = { ln: 14, r: 16, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

type Profile = { ln: number; r: number; p: number };
type Parsed = { profile: Profile; salt: Buffer | string; key: Buffer; legacy: boolean };

const LEGACY_HASH = /^([0-9a-f]{32}):([0-9a-f]{128})$/;
const PHC_HASH = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{22,86})\$([A-Za-z0-9+/]{43,86})$/;
// A stored hash can't make a check cost more than this, so a corrupt row fails instead of stalling the Worker.
const MAX_MEMORY = 64 * 1024 * 1024;
const MAX_WORK = 4 * 2 ** CURRENT.ln * CURRENT.r * CURRENT.p;

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');

function derive(password: string, salt: Buffer | string, { ln, r, p }: Profile, length: number): Promise<Buffer> {
  const N = 2 ** ln;
  return new Promise((resolve, reject) => {
    // NFKC matches what Better Auth did, so legacy hashes keep verifying for passwords typed differently.
    scrypt(password.normalize('NFKC'), salt, length, { N, r, p, maxmem: 2 * 128 * N * r + 128 * r * p }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function parse(hash: string): Parsed | null {
  if (typeof hash !== 'string') return null;
  const legacy = LEGACY_HASH.exec(hash);
  // Better Auth used the hex text itself as the salt, not the bytes it spells.
  if (legacy) return { profile: LEGACY, salt: legacy[1], key: Buffer.from(legacy[2], 'hex'), legacy: true };
  const phc = PHC_HASH.exec(hash);
  if (!phc) return null;
  const profile = { ln: Number(phc[1]), r: Number(phc[2]), p: Number(phc[3]) };
  const salt = Buffer.from(phc[4], 'base64');
  const key = Buffer.from(phc[5], 'base64');
  if (profile.ln < 10 || profile.r < 1 || profile.p < 1) return null;
  if (128 * 2 ** profile.ln * profile.r > MAX_MEMORY || 2 ** profile.ln * profile.r * profile.p > MAX_WORK) return null;
  if (salt.length < SALT_BYTES || salt.length > 64 || key.length < KEY_BYTES || key.length > 64) return null;
  if (base64(salt) !== phc[4] || base64(key) !== phc[5]) return null;
  return { profile, salt, key, legacy: false };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, CURRENT, KEY_BYTES);
  return `$scrypt$ln=${CURRENT.ln},r=${CURRENT.r},p=${CURRENT.p}$${base64(salt)}$${base64(key)}`;
}

async function matches(parsed: Parsed, password: string): Promise<boolean> {
  const key = await derive(password, parsed.salt, parsed.profile, parsed.key.length);
  return timingSafeEqual(key, parsed.key);
}

/** Better Auth's verify signature. An unreadable hash is a wrong password, never an error. */
export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const parsed = parse(hash);
  if (!parsed) {
    // The same work as a real check, so a damaged row looks like any other account.
    await derive(password, randomBytes(SALT_BYTES), CURRENT, KEY_BYTES);
    return false;
  }
  return matches(parsed, password);
}

/** Whether a stored hash should be replaced by a CURRENT one. */
export function needsRehash(hash: string): boolean {
  const parsed = parse(hash);
  if (!parsed || parsed.legacy) return true;
  const { ln, r, p } = parsed.profile;
  return ln !== CURRENT.ln || r !== CURRENT.r || p !== CURRENT.p || parsed.key.length !== KEY_BYTES;
}

/**
 * Call after `password` has been accepted for `userId`: replaces an outdated stored hash with a CURRENT one.
 * The stored hash is checked again first and only that exact value is replaced, so a password changed in
 * the meantime is never overwritten. Never throws; a failure leaves the old hash, which still works.
 */
export async function upgradePasswordHash(userId: string, password: string): Promise<boolean> {
  try {
    const account = await env.DB.prepare("SELECT id, password FROM account WHERE userId = ? AND providerId = 'credential'")
      .bind(userId).first<{ id: string; password: string | null }>();
    if (!account?.password || !needsRehash(account.password)) return false;
    const parsed = parse(account.password);
    if (!parsed || !(await matches(parsed, password))) return false;
    // updatedAt is left alone: the password itself has not changed.
    const result = await env.DB.prepare('UPDATE account SET password = ? WHERE id = ? AND password = ?')
      .bind(await hashPassword(password), account.id, account.password).run();
    return (result.meta.changes ?? 0) > 0;
  } catch {
    console.error(JSON.stringify({ event: 'password_rehash_failed' }));
    return false;
  }
}
