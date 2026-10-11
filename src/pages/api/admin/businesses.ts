import { readForm } from '../../../lib/request-body';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ADMIN, canAccess } from '../../../lib/admin';
import { MEMBER_ROLE_LABELS, getBusiness, isMemberRole } from '../../../lib/businesses';
import { denyAdmin } from '../../../lib/audit';
import { cleanText, sameOrigin } from '../../../lib/forum';
import { auditStatement } from '../../../lib/users';

// Creating and editing a business's details happens on its admin pages, which can
// redisplay the form with errors. Everything else about a business goes through here.
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || !canAccess(locals.staffRole, ADMIN.businesses)) return denyAdmin(locals, request, 'business-admin', 'role');
  if (!sameOrigin(request)) return denyAdmin(locals, request, 'business-admin', 'origin');

  const form = await readForm(request);

  if (form instanceof Response) return form;
  const action = cleanText(form.get('action'));
  const business = await getBusiness(cleanText(form.get('businessId')));
  if (!business) return new Response('Business not found', { status: 404 });

  const now = Date.now();
  const target = { id: business.id, name: business.name };
  // Membership changes can be made from the business page or the user's page; go back where they came from.
  const returnTo = (userId: string | null, params: Record<string, string>) => {
    const url = new URL(userId && form.get('return') === 'user' ? `/admin/users/${userId}` : `/admin/businesses/${business.id}`, request.url);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return Response.redirect(url, 303);
  };

  switch (action) {
    case 'archive':
    case 'restore': {
      const status = action === 'archive' ? 'archived' : 'active';
      if (business.status === status) return returnTo(null, { notice: 'unchanged' });
      await env.DB.batch([
        env.DB.prepare('UPDATE businesses SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, business.id),
        auditStatement(actor, { business: target }, `business-${action}`),
      ]);
      return returnTo(null, { notice: action === 'archive' ? 'archived' : 'restored' });
    }

    case 'delete': {
      if (cleanText(form.get('confirm')).toLowerCase() !== business.name.toLowerCase()) return returnTo(null, { error: 'confirm' });
      const members = await env.DB.prepare('SELECT COUNT(*) AS count FROM business_members WHERE business_id = ?').bind(business.id).first<{ count: number }>();
      await env.DB.batch([
        auditStatement(actor, { business: target }, 'business-delete', members?.count ? `${members.count} member${members.count === 1 ? '' : 's'} removed` : undefined),
        env.DB.prepare('DELETE FROM businesses WHERE id = ?').bind(business.id),
      ]);
      const url = new URL('/admin/businesses', request.url);
      url.searchParams.set('deleted', business.name);
      return Response.redirect(url, 303);
    }

    case 'add-member': {
      // From the business page an admin types an email; from a user's page the user id is known.
      const userId = cleanText(form.get('userId'));
      const email = cleanText(form.get('email')).toLowerCase();
      const role = cleanText(form.get('role')) || 'member';
      const title = cleanText(form.get('title'));
      const user = userId
        ? await env.DB.prepare('SELECT id, name, email FROM "user" WHERE id = ?').bind(userId).first<{ id: string; name: string; email: string }>()
        : await env.DB.prepare('SELECT id, name, email FROM "user" WHERE email = ?').bind(email).first<{ id: string; name: string; email: string }>();
      if (!user) return returnTo(userId || null, { error: 'no-user' });
      if (!isMemberRole(role) || title.length > 80) return returnTo(user.id, { error: 'member' });
      if (business.status === 'archived') return returnTo(user.id, { error: 'archived' });
      const existing = await env.DB.prepare('SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?').bind(business.id, user.id).first();
      if (existing) return returnTo(user.id, { error: 'already-member' });
      await env.DB.batch([
        env.DB.prepare('INSERT INTO business_members (business_id, user_id, role, title, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(business.id, user.id, role, title || null, now),
        auditStatement(actor, { user, business: target }, 'member-add', `${business.name} as ${MEMBER_ROLE_LABELS[role]}${title ? `, ${title}` : ''}`),
      ]);
      return returnTo(user.id, { notice: 'member-added' });
    }

    case 'update-member':
    case 'remove-member': {
      const member = await env.DB.prepare(`
        SELECT u.id, u.name, u.email, m.role, m.title
        FROM business_members m JOIN "user" u ON u.id = m.user_id
        WHERE m.business_id = ? AND m.user_id = ?
      `).bind(business.id, cleanText(form.get('userId'))).first<{ id: string; name: string; email: string; role: 'owner' | 'member'; title: string | null }>();
      if (!member) return returnTo(null, { error: 'no-user' });
      const user = { id: member.id, name: member.name, email: member.email };

      if (action === 'remove-member') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM business_members WHERE business_id = ? AND user_id = ?').bind(business.id, member.id),
          auditStatement(actor, { user, business: target }, 'member-remove', business.name),
        ]);
        return returnTo(member.id, { notice: 'member-removed' });
      }

      const role = cleanText(form.get('role'));
      const title = cleanText(form.get('title'));
      if (!isMemberRole(role) || title.length > 80) return returnTo(member.id, { error: 'member' });
      const changes = [
        role !== member.role && `${MEMBER_ROLE_LABELS[member.role]} → ${MEMBER_ROLE_LABELS[role]}`,
        title !== (member.title ?? '') && `Title: ${member.title || '—'} → ${title || '—'}`,
      ].filter(Boolean);
      if (!changes.length) return returnTo(member.id, { notice: 'unchanged' });
      await env.DB.batch([
        env.DB.prepare('UPDATE business_members SET role = ?, title = ? WHERE business_id = ? AND user_id = ?').bind(role, title || null, business.id, member.id),
        auditStatement(actor, { user, business: target }, 'member-update', `${business.name}: ${changes.join('; ')}`),
      ]);
      return returnTo(member.id, { notice: 'member-updated' });
    }
  }

  return new Response('Invalid action', { status: 400 });
};
