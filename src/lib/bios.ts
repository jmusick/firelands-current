import { env } from 'cloudflare:workers';
import { auditStatement } from './users';

export const BIO_MAX = 600;

/** Plain text only: line endings normalized, control characters dropped, runs of blank lines collapsed. */
export function normalizeBio(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A bio as paragraphs for rendering; the caller escapes them (Astro does by default), so nothing here is HTML. */
export function bioParagraphs(bio: string): string[] {
  return bio.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** The public bio of a staff member. Null for anyone without a staff role, or with no bio written. */
export async function getStaffBio(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const row = await env.DB.prepare(`
    SELECT b.bio FROM staff_bios b JOIN staff_roles sr ON sr.user_id = b.user_id WHERE b.user_id = ?
  `).bind(userId).first<{ bio: string }>();
  return row?.bio ?? null;
}

export type SaveBioResult = 'saved' | 'cleared' | 'unchanged' | 'not-found' | 'not-staff' | 'too-long';

/**
 * Sets or clears a staff member's bio. Only accounts with a staff role can have one. The caller has already
 * checked that `actor` may edit `targetId` (themselves, or an administrator); an edit of someone else's bio
 * is recorded in the audit log, without the text.
 */
export async function saveStaffBio(actor: { id: string; name: string }, targetId: string, raw: string): Promise<SaveBioResult> {
  const bio = normalizeBio(raw);
  if (bio.length > BIO_MAX) return 'too-long';
  const target = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, sr.role, (SELECT bio FROM staff_bios WHERE user_id = u.id) AS bio
    FROM "user" u LEFT JOIN staff_roles sr ON sr.user_id = u.id WHERE u.id = ?
  `).bind(targetId).first<{ id: string; name: string; email: string; role: string | null; bio: string | null }>();
  if (!target) return 'not-found';
  if (!target.role) return 'not-staff';
  if (bio === (target.bio ?? '')) return 'unchanged';
  const statements = [
    bio
      ? env.DB.prepare('INSERT INTO staff_bios (user_id, bio, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at')
        .bind(target.id, bio, Date.now())
      : env.DB.prepare('DELETE FROM staff_bios WHERE user_id = ?').bind(target.id),
  ];
  if (actor.id !== target.id) {
    statements.push(auditStatement(actor, { user: target }, 'update-bio', bio ? `${target.bio ? 'Edited' : 'Wrote'} author bio (${bio.length} characters)` : 'Cleared author bio'));
  }
  await env.DB.batch(statements);
  return bio ? 'saved' : 'cleared';
}
