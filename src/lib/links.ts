import { env } from 'cloudflare:workers';
import { auditRecord, auditResource, changedFields, type AuditActor } from './audit';
import { cleanText } from './forum';

export const COUNTIES = {
  erie: 'Erie County', ottawa: 'Ottawa County', sandusky: 'Sandusky County',
  huron: 'Huron County', lorain: 'Lorain County', seneca: 'Seneca County',
} as const;

export const LINK_TYPES = {
  government: 'Government', chamber: 'Chamber of commerce', police: 'Police', fire: 'Fire & EMS',
  library: 'Library', sheriff: 'Sheriff', health: 'Public health', parks: 'Parks', elections: 'Elections',
} as const;

export type County = keyof typeof COUNTIES;
export type LinkType = keyof typeof LINK_TYPES;
export type LinkValues = {
  name: string; url: string; county: County | ''; community: string; category: LinkType | '';
  description: string; checked_on: string; status: 'draft' | 'published';
};
export type CommunityLink = LinkValues & { id: string; county: County; category: LinkType; created_at: number; updated_at: number };
export const emptyLink: LinkValues = { name: '', url: '', county: '', community: '', category: '', description: '', checked_on: '', status: 'draft' };
export const isLinkId = (id: string) => /^[\w-]{8,64}$/.test(id);

export async function listLinks(publishedOnly = false): Promise<CommunityLink[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM community_links ${publishedOnly ? "WHERE status = 'published'" : ''}
    ORDER BY county, community COLLATE NOCASE, category, name COLLATE NOCASE, id`).all<CommunityLink>();
  return results;
}

export async function getLink(id: string): Promise<CommunityLink | null> {
  if (!isLinkId(id)) return null;
  return env.DB.prepare('SELECT * FROM community_links WHERE id = ?').bind(id).first<CommunityLink>();
}

export function groupLinks(links: CommunityLink[]) {
  return Object.entries(COUNTIES).map(([county, name]) => {
    const places = new Map<string, CommunityLink[]>();
    for (const link of links.filter((link) => link.county === county)) {
      const group = places.get(link.community) ?? [];
      group.push(link);
      places.set(link.community, group);
    }
    return {
      county, name,
      places: [...places].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([community, items]) => ({
        community, items: items.sort((a, b) => Object.keys(LINK_TYPES).indexOf(a.category) - Object.keys(LINK_TYPES).indexOf(b.category) || a.name.localeCompare(b.name, 'en')),
      })),
    };
  }).filter((group) => group.places.length);
}

const AUDITED_FIELDS = { name: 'name', url: 'website', county: 'county', community: 'community', category: 'type', description: 'description', checked_on: 'last checked' };

export function readLinkValues(form: FormData): { values: LinkValues; errors: string[] } {
  const county = cleanText(form.get('county'));
  const category = cleanText(form.get('category'));
  const status = cleanText(form.get('status'));
  const values: LinkValues = {
    name: cleanText(form.get('name')), url: cleanText(form.get('url')),
    county: Object.hasOwn(COUNTIES, county) ? county as County : '',
    community: cleanText(form.get('community')).replace(/\s+/g, ' '),
    category: Object.hasOwn(LINK_TYPES, category) ? category as LinkType : '',
    description: cleanText(form.get('description')), checked_on: cleanText(form.get('checked_on')),
    status: status === 'published' ? 'published' : 'draft',
  };
  const errors: string[] = [];
  if (values.name.length < 2 || values.name.length > 140) errors.push('Name must be 2–140 characters.');
  if (!values.county) errors.push('Choose a county in our coverage area.');
  if (!values.category) errors.push('Choose a link type.');
  if (values.community.length > 80) errors.push('Community must be under 80 characters.');
  if (values.description.length > 300) errors.push('Description must be under 300 characters.');
  if (!['draft', 'published'].includes(status)) errors.push('Choose draft or published.');
  try {
    const url = new URL(values.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || values.url.length > 500) throw new Error();
    values.url = url.href;
  } catch { errors.push('Website must be a complete http:// or https:// address without sign-in credentials.'); }
  if (values.checked_on) {
    const date = new Date(`${values.checked_on}T00:00:00Z`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.checked_on) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== values.checked_on || values.checked_on > today) {
      errors.push('Last checked must be a real date on or before today.');
    }
  } else if (values.status === 'published') errors.push('Check the official website and enter the last-checked date before publishing.');
  return { values, errors };
}

export async function saveLinkFromForm(form: FormData, existing: CommunityLink | null, actor: AuditActor) {
  const { values, errors } = readLinkValues(form);
  if (errors.length) return { ok: false as const, values, errors };
  if (values.community) {
    const place = await env.DB.prepare('SELECT community FROM community_links WHERE county = ? AND community = ? COLLATE NOCASE ORDER BY created_at, id LIMIT 1')
      .bind(values.county, values.community).first<{ community: string }>();
    if (place) values.community = place.community;
  }
  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  const fields = [values.name, values.url, values.county, values.community, values.category, values.description, values.checked_on, values.status];
  const statement = existing
    ? env.DB.prepare('UPDATE community_links SET name = ?, url = ?, county = ?, community = ?, category = ?, description = ?, checked_on = ?, status = ?, updated_at = ? WHERE id = ?').bind(...fields, now, id)
    : env.DB.prepare('INSERT INTO community_links (name, url, county, community, category, description, checked_on, status, id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...fields, id, now, now);
  const audits = [];
  if (!existing) audits.push(auditResource(actor, { type: 'link', id, label: values.name }, 'link-create', values.status));
  else {
    const changed = changedFields(existing, values, AUDITED_FIELDS);
    if (changed.length) audits.push(auditRecord(actor, 'link', id, 'link-update', `Changed: ${changed.join(', ')}`));
  }
  if (values.status !== (existing?.status ?? 'draft')) audits.push(auditRecord(actor, 'link', id, values.status === 'published' ? 'link-publish' : 'link-unpublish'));
  const [result] = await env.DB.batch([statement, ...audits]);
  if (!result.meta.changes) return { ok: false as const, values, errors: ['This link was deleted. Return to the list and create a new link.'] };
  return { ok: true as const, id };
}

export async function deleteLink(id: string, actor: AuditActor): Promise<boolean> {
  const [, result] = await env.DB.batch([
    auditRecord(actor, 'link', id, 'link-delete'),
    env.DB.prepare('DELETE FROM community_links WHERE id = ?').bind(id),
  ]);
  return Boolean(result.meta.changes);
}
