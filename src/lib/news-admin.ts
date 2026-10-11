import { env } from 'cloudflare:workers';
import { type AuditActor, auditRecord, auditResource, changedFields } from './audit';
import { cleanText, ensureArticleThread } from './forum';
import { isMediaId } from './media';
import { type AdminArticle, type ArticleStatus, type Section, isSection, sanitizeSlug } from './news';

export type ArticleFormValues = {
  headline: string;
  slug: string;
  summary: string;
  body: string;
  section: Section | '';
  community: string;
  byline: string;
  author_id: string;
  /** Media library item shown above the story and in story lists; empty for none. */
  lead_media_id: string;
  /** Eligible for the random selection of the front page's large lead story. */
  featured: boolean;
  status: ArticleStatus;
};

export type ArticleFormResult =
  | { ok: true; id: string }
  | { ok: false; values: ArticleFormValues; errors: string[] };

export const emptyArticle: ArticleFormValues = {
  headline: '', slug: '', summary: '', body: '', section: '', community: '', byline: '', author_id: '', lead_media_id: '', featured: false, status: 'draft',
};

export function valuesFromArticle(article: AdminArticle): ArticleFormValues {
  const { headline, slug, summary, body, section, community, byline, status } = article;
  return { headline, slug, summary, body, section, community, byline, author_id: article.author_id ?? '', lead_media_id: article.lead_media_id ?? '', featured: article.featured === 1, status };
}

// Field names an audit entry lists when a story is edited. Status and featured have their own actions.
const AUDITED_FIELDS: Record<string, string> = {
  headline: 'headline', slug: 'URL slug', summary: 'summary', body: 'story text', section: 'section', community: 'community',
  byline: 'byline', author_id: 'author', lead_media_id: 'lead image',
};

/** Audit statements for one save: a create, or an update naming only the fields that changed, plus publish and feature changes. */
function articleAudit(actor: AuditActor, id: string, values: ArticleFormValues, existing: AdminArticle | null) {
  const before = existing ? valuesFromArticle(existing) : null;
  const statements = [];
  if (!before) {
    statements.push(auditResource(actor, { type: 'story', id, label: values.headline }, 'story-create', `/news/${values.slug}; ${values.status}`));
  } else {
    const changed = changedFields(before, values, AUDITED_FIELDS);
    if (changed.length) statements.push(auditRecord(actor, 'story', id, 'story-update', `Changed: ${changed.join(', ')}`));
  }
  if (values.status !== (before?.status ?? 'draft')) {
    statements.push(auditRecord(actor, 'story', id, values.status === 'published' ? 'story-publish' : 'story-unpublish'));
  }
  if (values.featured !== (before?.featured ?? false)) {
    statements.push(auditRecord(actor, 'story', id, values.featured ? 'story-feature' : 'story-unfeature'));
  }
  return statements;
}

export async function saveArticleFromForm(form: FormData, existing: AdminArticle | null, actor: AuditActor): Promise<ArticleFormResult> {
  const section = cleanText(form.get('section'));
  const headline = cleanText(form.get('headline'));
  const values: ArticleFormValues = {
    headline,
    slug: sanitizeSlug(cleanText(form.get('slug')) || headline),
    summary: cleanText(form.get('summary')),
    body: cleanText(form.get('body')),
    section: isSection(section) ? section : '',
    community: cleanText(form.get('community')),
    byline: cleanText(form.get('byline')),
    author_id: cleanText(form.get('author_id')),
    lead_media_id: cleanText(form.get('lead_media_id')),
    featured: form.get('featured') === '1',
    status: cleanText(form.get('status')) === 'published' ? 'published' : 'draft',
  };

  const errors: string[] = [];
  if (values.headline.length < 8 || values.headline.length > 160) errors.push('Headline must be 8–160 characters.');
  if (!values.slug) errors.push('URL slug is required.');
  if (values.summary.length < 20 || values.summary.length > 400) errors.push('Summary must be 20–400 characters.');
  if (values.body.length < 20 || values.body.length > 50000) errors.push('Story text must be 20–50,000 characters.');
  if (!values.section) errors.push('Choose a section.');
  if (!values.community || values.community.length > 60) errors.push('Community is required (up to 60 characters).');
  if (values.author_id) {
    const author = /^[\w-]{1,64}$/.test(values.author_id)
      ? await env.DB.prepare('SELECT name FROM "user" WHERE id = ? AND id != ?').bind(values.author_id, 'newsroom').first<{ name: string }>()
      : null;
    if (!author) errors.push('Choose an existing author account.');
    else values.byline = author.name;
  }
  if (!values.byline || values.byline.length > 80) errors.push('Byline is required (up to 80 characters).');

  if (values.lead_media_id && !(isMediaId(values.lead_media_id) && await env.DB.prepare('SELECT 1 FROM media WHERE id = ?').bind(values.lead_media_id).first())) {
    errors.push('The lead image is no longer in the media library. Choose another.');
    values.lead_media_id = '';
  }

  if (!errors.length) {
    const clash = await env.DB.prepare('SELECT id FROM news_articles WHERE slug = ? AND id != ?')
      .bind(values.slug, existing?.id ?? '').first();
    if (clash) errors.push('Another story already uses that URL slug.');
  }
  if (errors.length) return { ok: false, values, errors };

  const now = Date.now();
  // Keep the original publish date if a story is unpublished and later republished.
  const publishedAt = values.status === 'published' ? existing?.published_at ?? now : existing?.published_at ?? null;
  const id = existing?.id ?? crypto.randomUUID();
  // Update existing stories directly so the insert's conflict policy cannot override the Facebook queue trigger.
  const save = env.DB.prepare(existing ? `
    UPDATE news_articles SET slug = ?2, headline = ?3, summary = ?4, body = ?5,
      section = ?6, community = ?7, byline = ?8, author_id = ?14, lead_media_id = ?12,
      featured = ?13, status = ?9, published_at = ?10, updated_at = ?11
    WHERE id = ?1
  ` : `
    INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, author_id, lead_media_id, featured, status, published_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?14, ?12, ?13, ?9, ?10, ?11, ?11)
  `).bind(id, values.slug, values.headline, values.summary, values.body, values.section, values.community,
    values.byline, values.status, publishedAt, now, values.lead_media_id || null, values.featured ? 1 : 0, values.author_id || null);
  // The audit entries share the save's batch, so a story never changes without a record of who changed it.
  await env.DB.batch([save, ...articleAudit(actor, id, values, existing)]);
  if (publishedAt !== null && values.status === 'published') await ensureArticleThread({ id, headline: values.headline, summary: values.summary, published_at: publishedAt });
  return { ok: true, id };
}
