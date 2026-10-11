import { readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ADMIN, canAccess, gainsAccess } from '../../../lib/admin';
import { denyAdmin } from '../../../lib/audit';
import { cleanText, sameOrigin } from '../../../lib/forum';
import { passwordProblem } from '../../../lib/password-policy';
import { isFresh, reauthPath } from '../../../lib/reauth';
import { ROLE_LABELS, isStaffRole } from '../../../lib/staff';
import { deletedAccountTipStatements } from '../../../lib/tip-retention';
import { EMAIL, auditStatement, createPasswordUser, hashPassword } from '../../../lib/users';

const DURATIONS: Record<string, number | null> = { '1': 1, '7': 7, '30': 30, permanent: null };

// Actions that change who can do what, or who can sign in to an account. They need a password confirmed
// within REAUTH_WINDOW_MS, so a borrowed or forgotten session can't make them. The value is the reason /reauth shows.
const NEEDS_REAUTH: Record<string, string> = { create: 'create', 'set-role': 'role', 'set-password': 'password', delete: 'delete' };

/** The error code for a password the policy refuses; 'password' is the length message the forms already have. */
const passwordError = (problem: NonNullable<Awaited<ReturnType<typeof passwordProblem>>>) => (problem === 'length' ? 'password' : `password-${problem}`);

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || !canAccess(locals.staffRole, ADMIN.users)) return denyAdmin(locals, request, 'user-admin', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'user-admin', 'origin');

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const action = cleanText(form.get('action'));
  const go = (path: string, params: Record<string, string>) => {
    const url = new URL(path, request.url);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return Response.redirect(url, 303);
  };
  // A stale session is sent to confirm its password and then back to the page the action came from, where
  // nothing has been changed yet.
  const fresh = await isFresh(locals.session?.id);
  const reauth = (back: string, reason: string) => Response.redirect(new URL(reauthPath(back, reason), request.url), 303);

  if (action === 'create') {
    if (!fresh) return reauth('/admin/users/new', NEEDS_REAUTH.create);
    const name = cleanText(form.get('name'));
    const email = cleanText(form.get('email')).toLowerCase();
    const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
    const role = cleanText(form.get('role'));
    if (!name || name.length > 80 || !EMAIL.test(email) || email.length > 254) return go('/admin/users/new', { error: 'profile' });
    const problem = await passwordProblem(password, { email, name });
    if (problem) return go('/admin/users/new', { error: passwordError(problem) });
    if (role && !isStaffRole(role)) return go('/admin/users/new', { error: 'role' });
    if (await env.DB.prepare('SELECT 1 FROM "user" WHERE email = ?').bind(email).first()) return go('/admin/users/new', { error: 'email-taken' });

    const id = await createPasswordUser(name, email, password);
    const target = { user: { id, name, email } };
    await env.DB.batch([
      auditStatement(actor, target, 'create', role ? `Role: ${ROLE_LABELS[role as keyof typeof ROLE_LABELS]}` : undefined),
      ...(role ? [
        env.DB.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?)').bind(id, role, Date.now()),
        auditStatement(actor, target, 'set-role', `None → ${ROLE_LABELS[role as keyof typeof ROLE_LABELS]}`),
      ] : []),
    ]);
    return go(`/admin/users/${id}`, { notice: 'created' });
  }

  const userId = cleanText(form.get('userId'));
  const target = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.emailVerified, sr.role
    FROM "user" u LEFT JOIN staff_roles sr ON sr.user_id = u.id WHERE u.id = ?
  `).bind(userId).first<{ id: string; name: string; email: string; emailVerified: number; role: string | null }>();
  if (!target) return new Response('User not found', { status: 404 });

  const page = `/admin/users/${target.id}`;
  const self = target.id === actor.id;
  const now = Date.now();
  const audit = (name: string, detail?: string) => auditStatement(actor, { user: target }, name, detail);
  if (Object.hasOwn(NEEDS_REAUTH, action) && !fresh) return reauth(page, NEEDS_REAUTH[action]);

  switch (action) {
    case 'update-profile': {
      const name = cleanText(form.get('name'));
      const email = cleanText(form.get('email')).toLowerCase();
      const verified = form.get('emailVerified') === 'on' ? 1 : 0;
      if (!name || name.length > 80 || !EMAIL.test(email) || email.length > 254) return go(page, { error: 'profile' });
      if (email !== target.email && await env.DB.prepare('SELECT 1 FROM "user" WHERE email = ? AND id != ?').bind(email, target.id).first()) {
        return go(page, { error: 'email-taken' });
      }
      const changes = [
        name !== target.name && `Name: ${target.name} → ${name}`,
        email !== target.email && `Email: ${target.email} → ${email}`,
        verified !== target.emailVerified && `Email verified: ${verified ? 'yes' : 'no'}`,
      ].filter(Boolean);
      if (!changes.length) return go(page, { notice: 'unchanged' });
      // A new address, or marking one verified, is a way to take over an account through password reset.
      if ((email !== target.email || verified !== target.emailVerified) && !fresh) return reauth(page, 'profile');
      await env.DB.batch([
        env.DB.prepare('UPDATE "user" SET name = ?, email = ?, emailVerified = ?, updatedAt = ? WHERE id = ?')
          .bind(name, email, verified, new Date(now).toISOString(), target.id),
        audit('update-profile', changes.join('; ')),
      ]);
      return go(page, { notice: 'profile' });
    }

    case 'set-role': {
      const role = cleanText(form.get('role'));
      if (self) return go(page, { error: 'self-role' });
      if (role && !isStaffRole(role)) return go(page, { error: 'role' });
      if ((role || null) === target.role) return go(page, { notice: 'unchanged' });
      const label = (r: string | null) => (r && isStaffRole(r) ? ROLE_LABELS[r] : 'None');
      const suspended = await env.DB.prepare('SELECT 1 FROM user_suspensions WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)').bind(target.id, now).first();
      if (role && suspended) return go(page, { error: 'suspended-role' });
      // Anyone who gains access to more of the admin panel signs in again, so no session opened before the
      // change carries on with new authority. Taking access away needs no sign-out: the role is read from
      // the database on every request (src/middleware.ts), so it ends at once.
      const elevated = gainsAccess(target.role && isStaffRole(target.role) ? target.role : null, role && isStaffRole(role) ? role : null);
      const open = elevated
        ? (await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId = ?').bind(target.id).first<{ n: number }>())?.n ?? 0
        : 0;
      await env.DB.batch([
        role
          ? env.DB.prepare('INSERT INTO staff_roles (user_id, role, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET role = excluded.role').bind(target.id, role, now)
          : env.DB.prepare('DELETE FROM staff_roles WHERE user_id = ?').bind(target.id),
        ...(elevated ? [env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(target.id)] : []),
        audit('set-role', `${label(target.role)} → ${label(role || null)}${elevated ? `; signed out ${open} session${open === 1 ? '' : 's'}` : ''}`),
      ]);
      return go(page, { notice: 'role' });
    }

    case 'suspend': {
      const reason = cleanText(form.get('reason'));
      const duration = cleanText(form.get('duration'));
      const hideContent = form.get('hideContent') === 'on';
      if (self) return go(page, { error: 'self' });
      if (target.role) return go(page, { error: 'staff' });
      if (reason.length < 3 || reason.length > 500 || !(duration in DURATIONS)) return go(page, { error: 'suspend' });
      const days = DURATIONS[duration];
      const expiresAt = days === null ? null : now + days * 86400000;
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO user_suspensions (user_id, reason, suspended_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, suspended_by = excluded.suspended_by, created_at = excluded.created_at, expires_at = excluded.expires_at
        `).bind(target.id, reason, actor.id, now, expiresAt),
        env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(target.id),
        ...(hideContent ? hideAll(target.id, now) : []),
        audit('suspend', `${days === null ? 'Until lifted' : `${days} day${days === 1 ? '' : 's'}`}: ${reason}${hideContent ? ' (posts hidden)' : ''}`),
      ]);
      return go(page, { notice: 'suspended' });
    }

    case 'unsuspend': {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_suspensions WHERE user_id = ?').bind(target.id),
        audit('unsuspend'),
      ]);
      return go(page, { notice: 'unsuspended' });
    }

    case 'revoke-session': {
      const sessionId = cleanText(form.get('sessionId'));
      if (sessionId === locals.session?.id) return go(page, { error: 'current-session' });
      const removed = await env.DB.prepare('DELETE FROM session WHERE id = ? AND userId = ?').bind(sessionId, target.id).run();
      if (removed.meta.changes) await audit('revoke-session').run();
      return go(page, { notice: 'session' });
    }

    case 'revoke-sessions': {
      // Your own current session is kept so an admin doesn't lock themselves out of this page.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM session WHERE userId = ? AND id != ?').bind(target.id, locals.session?.id ?? ''),
        audit('revoke-sessions'),
      ]);
      return go(page, { notice: 'sessions' });
    }

    case 'set-password': {
      const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
      if (self) return go(page, { error: 'self-password' });
      const problem = await passwordProblem(password, { email: target.email, name: target.name });
      if (problem) return go(page, { error: passwordError(problem) });
      const hash = await hashPassword(password);
      const iso = new Date(now).toISOString();
      const existing = await env.DB.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'").bind(target.id).first<{ id: string }>();
      await env.DB.batch([
        existing
          ? env.DB.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE id = ?').bind(hash, iso, existing.id)
          : env.DB.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), target.id, target.id, hash, iso, iso),
        env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(target.id),
        audit('set-password', existing ? undefined : 'Added email & password sign-in'),
      ]);
      return go(page, { notice: 'password' });
    }

    case 'hide-content': {
      await env.DB.batch([...hideAll(target.id, now), audit('hide-content')]);
      return go(page, { notice: 'hidden' });
    }

    case 'delete': {
      if (self) return go(page, { error: 'self' });
      if (target.role) return go(page, { error: 'staff' });
      if (cleanText(form.get('confirm')).toLowerCase() !== target.email) return go(page, { error: 'confirm' });
      // Threads, replies, reports, sessions and sign-in methods cascade with the user row. News tips follow
      // the retention policy: unused ones are deleted, reviewed and converted ones stay unlinked.
      const tips = await env.DB.prepare(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status IN ('unread', 'declined') THEN 1 END) AS removed
        FROM news_submissions WHERE submitter_user_id = ?`).bind(target.id).first<{ total: number; removed: number }>();
      const tipDetail = tips?.total ? `News tips: ${tips.removed} deleted, ${tips.total - tips.removed} kept as reporting record` : undefined;
      await env.DB.batch([
        audit('delete', tipDetail),
        ...deletedAccountTipStatements(env.DB, target.id),
        env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(target.id),
      ]);
      return go('/admin/users', { deleted: target.email });
    }
  }

  return new Response('Invalid action', { status: 400 });
};

/** Hides every thread and reply by a user and closes the open reports about them. */
function hideAll(userId: string, now: number) {
  return [
    env.DB.prepare("UPDATE forum_threads SET status = 'hidden', updated_at = ? WHERE author_id = ? AND status = 'published'").bind(now, userId),
    env.DB.prepare("UPDATE forum_replies SET status = 'hidden', updated_at = ? WHERE author_id = ? AND status = 'published'").bind(now, userId),
    env.DB.prepare(`
      UPDATE forum_reports SET status = 'resolved', resolved_at = ?1
      WHERE status = 'open' AND (
        thread_id IN (SELECT id FROM forum_threads WHERE author_id = ?2) OR
        reply_id IN (SELECT id FROM forum_replies WHERE author_id = ?2))
    `).bind(now, userId),
  ];
}
