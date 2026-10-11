import { env } from 'cloudflare:workers';
import { Marked } from 'marked';
import type { MediaRecord } from './media';

export const SECTIONS = {
  local: 'Local News',
  government: 'Government',
  business: 'Business',
  schools: 'Schools',
  community: 'Community',
  outdoors: 'Outdoors',
} as const;

export type Section = keyof typeof SECTIONS;
export type ArticleStatus = 'draft' | 'published';

export type Article = {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  body: string;
  section: Section;
  community: string;
  byline: string;
  author_id: string | null;
  published_at: number;
  updated_at: number;
} & LeadImage;

/** The story's lead image, from the media library; all null when it has none. */
export type LeadImage = {
  lead_key: string | null; lead_width: number | null; lead_height: number | null;
  lead_alt: string | null; lead_caption: string | null; lead_credit: string | null;
};

export const LEAD_COLUMNS = `m.object_key AS lead_key, m.width AS lead_width, m.height AS lead_height, m.alt AS lead_alt, m.caption AS lead_caption, m.credit AS lead_credit`;

/** Saves this soon after publication are treated as finishing touches, not a modification worth announcing. */
const MODIFIED_GRACE_MS = 60 * 60 * 1000;

/** schema.org NewsArticle data for a story page; fields the story doesn't have are left out. */
export function newsArticleJsonLd(a: Article, origin: string): string {
  const url = new URL(`/news/${a.slug}`, origin).href;
  const lead = leadMedia(a);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.headline,
    description: a.summary,
    mainEntityOfPage: url,
    url,
    datePublished: new Date(a.published_at).toISOString(),
    ...(a.updated_at - a.published_at > MODIFIED_GRACE_MS ? { dateModified: new Date(a.updated_at).toISOString() } : {}),
    author: {
      '@type': 'Person',
      name: a.byline,
      ...(a.author_id ? { url: new URL(`/profile/${encodeURIComponent(a.author_id)}`, origin).href } : {}),
    },
    publisher: { '@type': 'Organization', name: 'Firelands Current', url: new URL('/', origin).href },
    ...(lead ? { image: [new URL(`/media/${lead.object_key}`, origin).href] } : {}),
  };
  // Keeps "</script>" in any field from closing the tag it's written into.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** The lead image in the shape figureHtml takes, or null. */
export const leadMedia = (a: LeadImage) => a.lead_key
  ? { object_key: a.lead_key, width: a.lead_width!, height: a.lead_height!, alt: a.lead_alt ?? '', caption: a.lead_caption ?? '', credit: a.lead_credit ?? '' }
  : null;

export type AdminArticle = Omit<Article, 'published_at' | 'updated_at' | keyof LeadImage> & {
  lead_media_id: string | null;
  featured: number;
  status: ArticleStatus;
  published_at: number | null;
  updated_at: number;
};

export function isSection(value: string | null | undefined): value is Section {
  return typeof value === 'string' && Object.hasOwn(SECTIONS, value);
}

export async function listArticles(page = 0, section?: Section, pageSize = 20): Promise<Article[]> {
  const result = await env.DB.prepare(`
    SELECT a.id, a.slug, a.headline, a.summary, a.body, a.section, a.community, COALESCE(u.name, a.byline) AS byline, a.author_id, a.published_at, a.updated_at, ${LEAD_COLUMNS}
    FROM news_articles a LEFT JOIN "user" u ON u.id = a.author_id LEFT JOIN media m ON m.id = a.lead_media_id
    WHERE a.status = 'published' AND (?1 IS NULL OR a.section = ?1)
    ORDER BY a.published_at DESC
    LIMIT ?2 OFFSET ?3
  `).bind(section ?? null, pageSize + 1, page * pageSize).all<Article>();
  return result.results;
}

/** A random published featured story (or the newest), followed by the newest other stories. */
export async function frontPageArticles(others = 4): Promise<{ lead: Article | null; more: Article[] }> {
  const lead = await env.DB.prepare(`
    SELECT a.id, a.slug, a.headline, a.summary, a.body, a.section, a.community, COALESCE(u.name, a.byline) AS byline, a.author_id, a.published_at, ${LEAD_COLUMNS}
    FROM news_articles a LEFT JOIN "user" u ON u.id = a.author_id LEFT JOIN media m ON m.id = a.lead_media_id
    WHERE a.status = 'published'
    ORDER BY a.featured DESC, CASE WHEN a.featured = 1 THEN random() END, a.published_at DESC
    LIMIT 1
  `).first<Article>();
  if (!lead) return { lead: null, more: [] };
  const result = await env.DB.prepare(`
    SELECT a.id, a.slug, a.headline, a.summary, a.body, a.section, a.community, COALESCE(u.name, a.byline) AS byline, a.author_id, a.published_at, ${LEAD_COLUMNS}
    FROM news_articles a LEFT JOIN "user" u ON u.id = a.author_id LEFT JOIN media m ON m.id = a.lead_media_id
    WHERE a.status = 'published' AND a.id != ?
    ORDER BY a.published_at DESC
    LIMIT ?
  `).bind(lead.id, others).all<Article>();
  return { lead, more: result.results };
}

/** The newest `perSection` stories in each section, skipping `excludeIds` (stories already on the page). Sections with no stories are left out. */
export async function articlesBySection(perSection = 3, excludeIds: string[] = []): Promise<{ section: Section; articles: Article[] }[]> {
  const skip = excludeIds.map(() => '?').join(',');
  const result = await env.DB.prepare(`
    SELECT * FROM (
      SELECT a.id, a.slug, a.headline, a.summary, a.body, a.section, a.community, COALESCE(u.name, a.byline) AS byline, a.author_id, a.published_at, ${LEAD_COLUMNS},
        ROW_NUMBER() OVER (PARTITION BY a.section ORDER BY a.published_at DESC) AS rank
      FROM news_articles a LEFT JOIN "user" u ON u.id = a.author_id LEFT JOIN media m ON m.id = a.lead_media_id
      WHERE a.status = 'published'${skip ? ` AND a.id NOT IN (${skip})` : ''}
    ) WHERE rank <= ? ORDER BY published_at DESC
  `).bind(...excludeIds, perSection).all<Article>();
  return (Object.keys(SECTIONS) as Section[])
    .map((section) => ({ section, articles: result.results.filter((a) => a.section === section) }))
    .filter((group) => group.articles.length > 0);
}

export type RelatedArticle = Pick<Article, 'id' | 'slug' | 'headline' | 'summary' | 'section' | 'community' | 'published_at'>;

/**
 * Other published stories worth reading after this one. The only relatedness signals the schema has are
 * the section and the community, so a story in the same section ranks above one that only shares the
 * community (2 points against 1), and ties go to the newest. Stories with neither in common never appear.
 */
export async function relatedArticles(article: Pick<Article, 'id' | 'section' | 'community'>, limit = 4): Promise<RelatedArticle[]> {
  const result = await env.DB.prepare(`
    SELECT a.id, a.slug, a.headline, a.summary, a.section, a.community, a.published_at,
      (a.section = ?1) * 2 + (a.community = ?2 COLLATE NOCASE) AS score
    FROM news_articles a
    WHERE a.status = 'published' AND a.id != ?3 AND (a.section = ?1 OR a.community = ?2 COLLATE NOCASE)
    ORDER BY score DESC, a.published_at DESC
    LIMIT ?4
  `).bind(article.section, article.community, article.id, limit).all<RelatedArticle>();
  return result.results;
}

export async function getArticle(slug: string): Promise<Article | null> {
  return env.DB.prepare(`
    SELECT a.id, a.slug, a.headline, a.summary, a.body, a.section, a.community, COALESCE(u.name, a.byline) AS byline, a.author_id, a.published_at, ${LEAD_COLUMNS}
    FROM news_articles a LEFT JOIN "user" u ON u.id = a.author_id LEFT JOIN media m ON m.id = a.lead_media_id
    WHERE a.slug = ? AND a.status = 'published'
  `).bind(slug).first<Article>();
}

export async function listAdminArticles(): Promise<AdminArticle[]> {
  const result = await env.DB.prepare(`
    SELECT id, slug, headline, summary, body, section, community, byline, author_id, lead_media_id, featured, status, published_at, updated_at
    FROM news_articles
    ORDER BY COALESCE(published_at, updated_at) DESC
  `).all<AdminArticle>();
  return result.results;
}

export async function getAdminArticle(id: string): Promise<AdminArticle | null> {
  return env.DB.prepare(`
    SELECT id, slug, headline, summary, body, section, community, byline, author_id, lead_media_id, featured, status, published_at, updated_at
    FROM news_articles
    WHERE id = ?
  `).bind(id).first<AdminArticle>();
}

export function sanitizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeUrl = (href: string) => /^(https?:|mailto:|\/(?!\/)|#)/i.test(href.trim());

/** A library image as a story shows it: a figure with its caption and credit. */
export function figureHtml(media: { object_key: string; width: number; height: number; alt: string; caption: string; credit: string }, opts: { alt?: string; className?: string; eager?: boolean } = {}): string {
  const alt = opts.alt || media.alt;
  const caption = [media.caption && `<span class="caption">${escapeHtml(media.caption)}</span>`, media.credit && `<span class="credit">${escapeHtml(media.credit)}</span>`].filter(Boolean).join(' ');
  return `<figure class="${opts.className ?? 'story-figure'}"><img src="/media/${escapeHtml(media.object_key)}" alt="${escapeHtml(alt)}" width="${media.width}" height="${media.height}"${opts.eager ? ' fetchpriority="high"' : ' loading="lazy"'} />${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
}

type StoryMedia = Map<string, MediaRecord>;

// Story bodies are Markdown. Raw HTML is shown as text and only http(s), mailto,
// site-relative and fragment links are rendered, so an editor account can't inject script.
// Images must come from the media library, so every picture on the site carries a credit
// and nothing is loaded from other sites; anything else shows as its alt text.
function markdownFor(media: StoryMedia) {
  const libraryImage = (href: string) => media.get(href.trim().replace(/^\/media\//, ''));
  return new Marked({
    gfm: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (!safeUrl(href)) return label;
        const external = /^https?:/i.test(href);
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${label}</a>`;
      },
      image({ href, text }) {
        const item = libraryImage(href);
        if (!item) return escapeHtml(text);
        return `<img src="/media/${escapeHtml(item.object_key)}" alt="${escapeHtml(text || item.alt)}" width="${item.width}" height="${item.height}" loading="lazy" />`;
      },
      // An image on a line of its own becomes a captioned figure.
      paragraph({ tokens }) {
        const content = tokens.filter((t) => !(t.type === 'text' && !t.raw.trim()));
        const only = content.length === 1 && content[0].type === 'image' ? content[0] : null;
        const item = only && libraryImage(only.href);
        return item ? figureHtml(item, { alt: only.text }) : false;
      },
    },
  });
}

/**
 * The body rendered as its top-level blocks (paragraphs, headings, lists…), so ads can sit between them.
 * `media` holds the library items the body refers to; see mediaKeysIn and mediaByKeys.
 */
export function renderBodyBlocks(body: string, media: StoryMedia = new Map()): string[] {
  const markdown = markdownFor(media);
  const tokens = markdown.lexer(body);
  return tokens.filter((t) => t.type !== 'space' && t.type !== 'def').map((t) => markdown.parser(Object.assign([t], { links: tokens.links })));
}
