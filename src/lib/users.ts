import { env } from 'cloudflare:workers';
import { createAuth } from './auth';
import { NEWSROOM_USER_ID } from './forum';
import { hashPassword, upgradePasswordHash, verifyPassword } from './password-hash';
import type { StaffRole } from './staff';

export const PAGE_SIZE = 50;
export { MAX_PASSWORD, MIN_PASSWORD } from './password-policy';
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserFilters = {
  q: string;
  role: '' | 'staff' | 'member' | StaffRole;
  status: '' | 'active' | 'suspended';
  sort: 'newest' | 'oldest' | 'name' | 'active';
  /** A business id, 'none' for users in no business, or '' for everyone. */
  business: string;
  page: number;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  createdAt: string;
  role: StaffRole | null;
  suspended: number;
  last_active: string | null;
  providers: string | null;
  posts: number;
  businesses: string | null;
};

export type Suspension = { reason: string; created_at: number; expires_at: number | null; suspended_by_name: string | null };
export type UserSession = { id: string; createdAt: string; updatedAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null };
export type UserPost = { id: string; thread_id: string; title: string; excerpt: string; status: 'published' | 'hidden'; created_at: number; kind: 'thread' | 'reply' };
export type AuditEntry = {
  id: string;
  actor_name: string;
  target_user_id: string | null;
  target_business_id: string | null;
  target_media_id: string | null;
  target_type: string | null;
  target_id: string | null;
  outcome: 'success' | 'denied';
  target_label: string;
  action: string;
  detail: string | null;
  created_at: number;
  user_exists?: number;
  business_exists?: number;
  media_exists?: number;
  /** Set by listAudit for a story, event, correction or news tip that still exists: where to open it. */
  resource_href?: string | null;
};

export type UserDetail = {
  user: { id: string; name: string; email: string; emailVerified: number; createdAt: string; updatedAt: string };
  role: StaffRole | null;
  suspension: Suspension | null;
  providers: { providerId: string; createdAt: string }[];
  sessions: UserSession[];
  posts: UserPost[];
  counts: { threads: number; replies: number; hidden: number; reports_filed: number; reports_against: number; tips_removed: number; tips_kept: number };
  audit: AuditEntry[];
};

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function filtersFrom(params: URLSearchParams): UserFilters {
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? '';
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    role: (['staff', 'member', 'admin', 'editor', 'moderator'].includes(role) ? role : '') as UserFilters['role'],
    status: status === 'active' || status === 'suspended' ? status : '',
    sort: (['oldest', 'name', 'active'].includes(sort) ? sort : 'newest') as UserFilters['sort'],
    business: (params.get('business') ?? '').trim().slice(0, 64),
    page: Math.max(0, Math.min(10000, Number.parseInt(params.get('page') ?? '', 10) || 0)),
  };
}

const ORDER: Record<UserFilters['sort'], string> = {
  newest: 'u.createdAt DESC',
  oldest: 'u.createdAt ASC',
  name: 'u.name COLLATE NOCASE ASC',
  active: 'last_active IS NULL, last_active DESC',
};

/** One page of users (plus one extra row, so the caller can tell whether another page exists). */
export async function listUsers(filters: UserFilters): Promise<UserRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [Date.now()];
  if (filters.q) {
    const like = `%${likeEscape(filters.q.toLowerCase())}%`;
    where.push("(lower(u.name) LIKE ? ESCAPE '\\' OR lower(u.email) LIKE ? ESCAPE '\\' OR u.id = ?)");
    binds.push(like, like, filters.q);
  }
  if (filters.role === 'staff') where.push('sr.role IS NOT NULL');
  else if (filters.role === 'member') where.push('sr.role IS NULL');
  else if (filters.role) { where.push('sr.role = ?'); binds.push(filters.role); }
  if (filters.status === 'suspended') where.push('sus.user_id IS NOT NULL');
  else if (filters.status === 'active') where.push('sus.user_id IS NULL');
  if (filters.business === 'none') where.push('NOT EXISTS (SELECT 1 FROM business_members m WHERE m.user_id = u.id)');
  else if (filters.business) { where.push('EXISTS (SELECT 1 FROM business_members m WHERE m.user_id = u.id AND m.business_id = ?)'); binds.push(filters.business); }
  where.push(`u.id != '${NEWSROOM_USER_ID}'`);
  binds.push(PAGE_SIZE + 1, filters.page * PAGE_SIZE);

  const result = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.emailVerified, u.createdAt, sr.role,
           sus.user_id IS NOT NULL AS suspended,
           (SELECT MAX(s.updatedAt) FROM session s WHERE s.userId = u.id) AS last_active,
           (SELECT group_concat(a.providerId, ',') FROM account a WHERE a.userId = u.id) AS providers,
           (SELECT COUNT(*) FROM forum_threads t WHERE t.author_id = u.id)
             + (SELECT COUNT(*) FROM forum_replies r WHERE r.author_id = u.id) AS posts,
           (SELECT group_concat(b.name, ', ') FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = u.id) AS businesses
    FROM "user" u
    LEFT JOIN staff_roles sr ON sr.user_id = u.id
    LEFT JOIN user_suspensions sus ON sus.user_id = u.id AND (sus.expires_at IS NULL OR sus.expires_at > ?1)
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${ORDER[filters.sort]}
    LIMIT ? OFFSET ?
  `).bind(...binds).all<UserRow>();
  return result.results;
}

export async function userCounts(): Promise<{ total: number; staff: number; suspended: number; new_week: number }> {
  const now = Date.now();
  const row = await env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM "user" WHERE id != '${NEWSROOM_USER_ID}') AS total,
           (SELECT COUNT(*) FROM staff_roles) AS staff,
           (SELECT COUNT(*) FROM user_suspensions WHERE expires_at IS NULL OR expires_at > ?1) AS suspended,
           (SELECT COUNT(*) FROM "user" WHERE id != '${NEWSROOM_USER_ID}' AND createdAt > ?2) AS new_week
  `).bind(now, new Date(now - 7 * 86400000).toISOString()).first<{ total: number; staff: number; suspended: number; new_week: number }>();
  return row ?? { total: 0, staff: 0, suspended: 0, new_week: 0 };
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const now = Date.now();
  const user = await env.DB.prepare('SELECT id, name, email, emailVerified, createdAt, updatedAt FROM "user" WHERE id = ?')
    .bind(id).first<UserDetail['user']>();
  if (!user) return null;

  const [role, suspension, providers, sessions, posts, counts, audit] = await env.DB.batch([
    env.DB.prepare('SELECT role FROM staff_roles WHERE user_id = ?').bind(id),
    env.DB.prepare(`
      SELECT s.reason, s.created_at, s.expires_at, u.name AS suspended_by_name
      FROM user_suspensions s LEFT JOIN "user" u ON u.id = s.suspended_by
      WHERE s.user_id = ? AND (s.expires_at IS NULL OR s.expires_at > ?)
    `).bind(id, now),
    env.DB.prepare('SELECT providerId, createdAt FROM account WHERE userId = ? ORDER BY createdAt').bind(id),
    env.DB.prepare('SELECT id, createdAt, updatedAt, expiresAt, ipAddress, userAgent FROM session WHERE userId = ? AND expiresAt > ? ORDER BY updatedAt DESC')
      .bind(id, new Date(now).toISOString()),
    env.DB.prepare(`
      SELECT * FROM (
        SELECT id, id AS thread_id, title, substr(body, 1, 200) AS excerpt, status, created_at, 'thread' AS kind
        FROM forum_threads WHERE author_id = ?1
        UNION ALL
        SELECT r.id, r.thread_id, t.title, substr(r.body, 1, 200), r.status, r.created_at, 'reply'
        FROM forum_replies r JOIN forum_threads t ON t.id = r.thread_id WHERE r.author_id = ?1
      ) ORDER BY created_at DESC LIMIT 25
    `).bind(id),
    env.DB.prepare(`
      SELECT (SELECT COUNT(*) FROM forum_threads WHERE author_id = ?1) AS threads,
             (SELECT COUNT(*) FROM forum_replies WHERE author_id = ?1) AS replies,
             (SELECT COUNT(*) FROM forum_threads WHERE author_id = ?1 AND status = 'hidden')
               + (SELECT COUNT(*) FROM forum_replies WHERE author_id = ?1 AND status = 'hidden') AS hidden,
             (SELECT COUNT(*) FROM forum_reports WHERE reporter_id = ?1) AS reports_filed,
             (SELECT COUNT(*) FROM forum_reports rep
                LEFT JOIN forum_threads t ON t.id = rep.thread_id
                LEFT JOIN forum_replies r ON r.id = rep.reply_id
              WHERE t.author_id = ?1 OR r.author_id = ?1) AS reports_against,
             (SELECT COUNT(*) FROM news_submissions WHERE submitter_user_id = ?1 AND status IN ('unread', 'declined')) AS tips_removed,
             (SELECT COUNT(*) FROM news_submissions WHERE submitter_user_id = ?1 AND status IN ('reviewed', 'converted')) AS tips_kept
    `).bind(id),
    env.DB.prepare('SELECT * FROM admin_audit_log WHERE target_user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 25').bind(id),
  ]);

  return {
    user,
    role: (role.results[0] as { role: StaffRole } | undefined)?.role ?? null,
    suspension: (suspension.results[0] as Suspension | undefined) ?? null,
    providers: providers.results as UserDetail['providers'],
    sessions: sessions.results as UserSession[],
    posts: posts.results as UserPost[],
    counts: counts.results[0] as UserDetail['counts'],
    audit: audit.results as AuditEntry[],
  };
}

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const result = await env.DB.prepare(`
    SELECT l.*, u.id IS NOT NULL AS user_exists, b.id IS NOT NULL AS business_exists, m.id IS NOT NULL AS media_exists,
      CASE
        WHEN l.target_type = 'story' AND a.id IS NOT NULL THEN '/admin/news/' || a.id
        WHEN l.target_type = 'event' AND e.id IS NOT NULL THEN '/admin/events/' || e.id
        WHEN l.target_type = 'correction' AND c.id IS NOT NULL THEN '/admin/corrections/' || c.id
        WHEN l.target_type = 'tip' AND s.id IS NOT NULL THEN '/admin/submissions/' || s.id
      END AS resource_href
    FROM admin_audit_log l
    LEFT JOIN "user" u ON u.id = l.target_user_id
    LEFT JOIN businesses b ON b.id = l.target_business_id
    LEFT JOIN media m ON m.id = l.target_media_id
    LEFT JOIN news_articles a ON l.target_type = 'story' AND a.id = l.target_id
    LEFT JOIN events e ON l.target_type = 'event' AND e.id = l.target_id
    LEFT JOIN corrections c ON l.target_type = 'correction' AND c.id = l.target_id
    LEFT JOIN news_submissions s ON l.target_type = 'tip' AND s.id = l.target_id
    ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?
  `).bind(limit).all<AuditEntry>();
  return result.results;
}

export type AuditTarget =
  | { user: { id: string; name: string; email: string }; business?: { id: string; name: string } }
  | { user?: undefined; business: { id: string; name: string } };

/** An audit entry about a user, a business, or (with both) a user's membership in a business. */
export function auditStatement(actor: { id: string; name: string }, target: AuditTarget, action: string, detail?: string) {
  const { user, business } = target;
  const label = user ? `${user.name} <${user.email}>` : business!.name;
  return env.DB.prepare(`
    INSERT INTO admin_audit_log (id, actor_id, actor_name, target_user_id, target_business_id, target_label, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), actor.id, actor.name, user?.id ?? null, business?.id ?? null, label, action, detail ?? null, Date.now());
}

export { hashPassword };

/** Whether `password` is the one this account signs in with. False for an account with no password. */
export async function verifyAccountPassword(userId: string, password: string): Promise<boolean> {
  const account = await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'")
    .bind(userId).first<{ password: string | null }>();
  if (!account?.password) return false;
  if (!(await verifyPassword({ hash: account.password, password }))) return false;
  await upgradePasswordHash(userId, password);
  return true;
}

/** Creates an email/password account the same way sign-up does, without signing anyone in. Staff vouch for the address, so it starts verified. */
export async function createPasswordUser(name: string, email: string, password: string): Promise<string> {
  const context = await createAuth().$context;
  const user = await context.internalAdapter.createUser({ name, email, emailVerified: true }, { method: 'email-password' });
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await hashPassword(password),
  });
  return user.id;
}

export const PROVIDER_LABELS: Record<string, string> = {
  credential: 'Email & password',
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
  microsoft: 'Microsoft',
};

export const AUDIT_LABELS: Record<string, string> = {
  facebook_queue: 'Queued Facebook story',
  facebook_record: 'Recorded Facebook post',
  create: 'Created account',
  'update-profile': 'Edited profile',
  'set-role': 'Changed staff role',
  suspend: 'Suspended',
  unsuspend: 'Lifted suspension',
  'revoke-session': 'Signed out a session',
  'revoke-sessions': 'Signed out all sessions',
  'set-password': 'Set a new password',
  'hide-content': 'Hid all posts',
  delete: 'Deleted account',
  'business-create': 'Created business',
  'business-update': 'Edited business',
  'business-archive': 'Archived business',
  'business-restore': 'Restored business',
  'business-delete': 'Deleted business',
  'member-add': 'Added to business',
  'member-update': 'Changed business membership',
  'member-remove': 'Removed from business',
  'ad-create': 'Created ad',
  'ad-update': 'Edited ad',
  'ad-activate': 'Activated ad',
  'ad-pause': 'Paused ad',
  'ad-delete': 'Deleted ad',
  'media-upload': 'Uploaded image',
  'media-update': 'Edited image details',
  'media-delete': 'Deleted image',
  'story-create': 'Created story',
  'story-update': 'Edited story',
  'story-publish': 'Published story',
  'story-unpublish': 'Unpublished story',
  'story-feature': 'Featured story',
  'story-unfeature': 'Removed story from featured',
  'story-delete': 'Deleted story',
  'story-save': 'Saved a story',
  'event-create': 'Created event',
  'event-update': 'Edited event',
  'event-publish': 'Published event',
  'event-unpublish': 'Returned event to draft',
  'event-cancel': 'Cancelled event',
  'event-delete': 'Deleted event',
  'event-save': 'Saved an event',
  'thread-hide': 'Hid discussion',
  'thread-restore': 'Restored discussion',
  'reply-hide': 'Hid reply',
  'report-dismiss': 'Dismissed report',
  'talk-moderate': 'Moderated Talk of the Town',
  'correction-corrected': 'Marked correction made',
  'correction-declined': 'Declined correction request',
  'correction-reopen': 'Reopened correction request',
  'correction-resolve': 'Resolved a correction request',
  'tip-reviewed': 'Marked news tip reviewed',
  'tip-declined': 'Declined news tip',
  'tip-converted': 'Converted news tip to a story',
  'tip-anonymized': 'Removed news tip submitter details',
  'tip-retention': 'Applied news tip retention',
  'tip-review': 'Reviewed a news tip',
  'user-admin': 'Changed a user account',
  'business-admin': 'Changed a business',
  'ad-admin': 'Changed an ad',
  'media-admin': 'Changed the media library',
  'facebook-resolve': 'Resolved a Facebook post',
};

/** Short, readable description of a browser user-agent string. */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export const fmtDate = (value: string | number) => new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' });
export const fmtDateTime = (value: string | number) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
