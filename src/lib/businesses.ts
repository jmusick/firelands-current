import { env } from 'cloudflare:workers';
import { cleanText } from './forum';
import { EMAIL, type AuditEntry } from './users';

export type BusinessKind = 'internal' | 'advertiser' | 'other';
export type MemberRole = 'owner' | 'member';

export const KIND_LABELS: Record<BusinessKind, string> = {
  internal: 'In-house',
  advertiser: 'Advertiser',
  other: 'Other',
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  member: 'Member',
};

export const isKind = (value: string): value is BusinessKind => value in KIND_LABELS;
export const isMemberRole = (value: string): value is MemberRole => value in MEMBER_ROLE_LABELS;

export type Business = {
  id: string;
  name: string;
  kind: BusinessKind;
  website: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  publisher_affiliated: number;
  status: 'active' | 'archived';
  created_at: number;
  updated_at: number;
};

export type BusinessRow = Business & { member_count: number; owners: string | null };
export type BusinessMember = { user_id: string; name: string; email: string; role: MemberRole; title: string | null; created_at: number; staff_role: string | null };
export type Membership = { business_id: string; name: string; kind: BusinessKind; status: Business['status']; role: MemberRole; title: string | null };

export type BusinessFilters = { q: string; kind: '' | BusinessKind; status: 'active' | 'archived' | 'all' };

export function businessFiltersFrom(params: URLSearchParams): BusinessFilters {
  const kind = params.get('kind') ?? '';
  const status = params.get('status') ?? '';
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    kind: isKind(kind) ? kind : '',
    status: status === 'archived' || status === 'all' ? status : 'active',
  };
}

export async function listBusinesses(filters: BusinessFilters): Promise<BusinessRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filters.q) {
    where.push("(lower(b.name) LIKE ? ESCAPE '\\' OR lower(b.email) LIKE ? ESCAPE '\\' OR lower(b.website) LIKE ? ESCAPE '\\')");
    const like = `%${filters.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    binds.push(like, like, like);
  }
  if (filters.kind) { where.push('b.kind = ?'); binds.push(filters.kind); }
  if (filters.status !== 'all') { where.push('b.status = ?'); binds.push(filters.status); }
  const result = await env.DB.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM business_members m WHERE m.business_id = b.id) AS member_count,
           (SELECT group_concat(u.name, ', ') FROM business_members m JOIN "user" u ON u.id = m.user_id
             WHERE m.business_id = b.id AND m.role = 'owner') AS owners
    FROM businesses b
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.kind = 'internal' DESC, b.name COLLATE NOCASE
    LIMIT 500
  `).bind(...binds).all<BusinessRow>();
  return result.results;
}

/** Active businesses, for pickers. */
export async function businessOptions(): Promise<{ id: string; name: string }[]> {
  const result = await env.DB.prepare("SELECT id, name FROM businesses WHERE status = 'active' ORDER BY name COLLATE NOCASE")
    .all<{ id: string; name: string }>();
  return result.results;
}

export async function getBusiness(id: string): Promise<Business | null> {
  return env.DB.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first<Business>();
}

export async function getBusinessDetail(id: string): Promise<{ business: Business; members: BusinessMember[]; audit: AuditEntry[] } | null> {
  const business = await getBusiness(id);
  if (!business) return null;
  const [members, audit] = await env.DB.batch([
    env.DB.prepare(`
      SELECT m.user_id, u.name, u.email, m.role, m.title, m.created_at, sr.role AS staff_role
      FROM business_members m
      JOIN "user" u ON u.id = m.user_id
      LEFT JOIN staff_roles sr ON sr.user_id = m.user_id
      WHERE m.business_id = ?
      ORDER BY m.role = 'owner' DESC, u.name COLLATE NOCASE
    `).bind(id),
    env.DB.prepare('SELECT * FROM admin_audit_log WHERE target_business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 25').bind(id),
  ]);
  return { business, members: members.results as BusinessMember[], audit: audit.results as AuditEntry[] };
}

export async function membershipsFor(userId: string): Promise<Membership[]> {
  const result = await env.DB.prepare(`
    SELECT m.business_id, b.name, b.kind, b.status, m.role, m.title
    FROM business_members m JOIN businesses b ON b.id = m.business_id
    WHERE m.user_id = ?
    ORDER BY b.name COLLATE NOCASE
  `).bind(userId).all<Membership>();
  return result.results;
}

export type BusinessFormValues = { name: string; kind: BusinessKind | ''; website: string; email: string; phone: string; notes: string; publisherAffiliated: boolean };
export type BusinessFormResult = { ok: true; values: BusinessFormValues } | { ok: false; values: BusinessFormValues; errors: string[] };

export const emptyBusiness: BusinessFormValues = { name: '', kind: '', website: '', email: '', phone: '', notes: '', publisherAffiliated: false };

export function valuesFromBusiness(b: Business): BusinessFormValues {
  return { name: b.name, kind: b.kind, website: b.website ?? '', email: b.email ?? '', phone: b.phone ?? '', notes: b.notes ?? '', publisherAffiliated: b.publisher_affiliated === 1 };
}

export async function validateBusinessForm(form: FormData, existingId: string | null): Promise<BusinessFormResult> {
  const kind = cleanText(form.get('kind'));
  let website = cleanText(form.get('website'));
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const values: BusinessFormValues = {
    name: cleanText(form.get('name')),
    kind: isKind(kind) ? kind : '',
    website,
    email: cleanText(form.get('email')).toLowerCase(),
    phone: cleanText(form.get('phone')),
    notes: cleanText(form.get('notes')),
    publisherAffiliated: form.get('publisherAffiliated') === '1',
  };

  const errors: string[] = [];
  if (values.name.length < 2 || values.name.length > 120) errors.push('Name must be 2–120 characters.');
  if (!values.kind) errors.push('Choose a type.');
  if (values.website) {
    try { new URL(values.website); } catch { errors.push('Website must be a valid address.'); }
    if (values.website.length > 300) errors.push('Website must be under 300 characters.');
  }
  if (values.email && (!EMAIL.test(values.email) || values.email.length > 254)) errors.push('Contact email must be a valid email address.');
  if (values.phone.length > 40) errors.push('Phone must be under 40 characters.');
  if (values.notes.length > 2000) errors.push('Notes must be under 2,000 characters.');
  if (!errors.length) {
    const clash = await env.DB.prepare('SELECT 1 FROM businesses WHERE name = ? COLLATE NOCASE AND id != ?').bind(values.name, existingId ?? '').first();
    if (clash) errors.push('Another business already has that name.');
  }
  return errors.length ? { ok: false, values, errors } : { ok: true, values };
}

/** Human-readable list of what changed between two versions of a business, for the audit log. */
export function describeChanges(before: BusinessFormValues, after: BusinessFormValues): string {
  const labels: Record<keyof BusinessFormValues, string> = { name: 'Name', kind: 'Type', website: 'Website', email: 'Email', phone: 'Phone', notes: 'Notes', publisherAffiliated: 'Publisher-connected' };
  return (Object.keys(labels) as (keyof BusinessFormValues)[])
    .filter((key) => before[key] !== after[key])
    .map((key) => {
      if (key === 'notes') return 'Notes edited';
      if (key === 'publisherAffiliated') return `${labels[key]}: ${before[key] ? 'yes' : 'no'} → ${after[key] ? 'yes' : 'no'}`;
      const show = (v: string) => (key === 'kind' && isKind(v) ? KIND_LABELS[v] : v) || '—';
      return `${labels[key]}: ${show(before[key] as string)} → ${show(after[key] as string)}`;
    })
    .join('; ');
}
