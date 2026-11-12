import { env } from 'cloudflare:workers';
import type { Category } from './events';
import { LEAD_COLUMNS, type LeadImage, type Section } from './news';

export const SEARCH_PAGE_SIZE = 20;
export const MAX_QUERY_LENGTH = 100;
export const MIN_QUERY_LENGTH = 2;
export const MAX_TERMS = 5;

type Common = { slug: string; title: string; summary: string; community: string } & LeadImage;
export type StoryResult = Common & { kind: 'story'; section: Section; byline: string; author_id: string | null; published_at: number };
export type EventResult = Common & {
  kind: 'event'; category: Category; status: 'published' | 'cancelled'; venue: string;
  starts_on: string; ends_on: string | null; start_time: string | null; end_time: string | null; hours_note: string;
};
export type SearchResult = StoryResult | EventResult;

/** Trims, collapses whitespace and caps the query; returns '' when there's too little to search for. */
export function normalizeQuery(raw: string | null | undefined): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  // Array.from counts code points, so the cap never splits an emoji or other surrogate pair.
  const capped = Array.from(collapsed).slice(0, MAX_QUERY_LENGTH).join('').trim();
  return Array.from(capped).length >= MIN_QUERY_LENGTH ? capped : '';
}

export const queryTerms = (query: string) => [...new Set(query.toLowerCase().split(' ').filter(Boolean))].slice(0, MAX_TERMS);

/** A LIKE pattern that matches the term anywhere, with LIKE's own wildcards and the escape character taken literally. */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Published stories and listed events (published or cancelled) that contain every term, with the total match count.
 * Results whose headline matches more terms come first, then the newest; events sort by their start date.
 *
 * LIKE rather than FTS5: D1's export can't include virtual tables, which would break backups and the restore drill,
 * and at this size a scan runs in D1 rather than against the Worker's CPU limit.
 */
export async function searchSite(query: string, page = 0, now = Date.now(), pageSize = SEARCH_PAGE_SIZE): Promise<{ results: SearchResult[]; total: number }> {
  const terms = queryTerms(query);
  if (!terms.length) return { results: [], total: 0 };
  // Terms bind to ?1…?n and the clock to ?n+1; the SQL holds only placeholders, never input text.
  const p = terms.map((_, i) => `?${i + 1}`);
  const nowParam = `?${terms.length + 1}`;
  const like = (column: string, param: string) => `${column} LIKE ${param} ESCAPE '\\'`;
  const everyTerm = (columns: string[]) => p.map((param) => `(${columns.map((c) => like(c, param)).join(' OR ')})`).join(' AND ');
  const titleHits = (column: string) => p.map((param) => `(CASE WHEN ${like(column, param)} THEN 1 ELSE 0 END)`).join(' + ');
  const matches = `
      SELECT 'story' AS kind, a.slug, a.headline AS title, a.summary, a.community, ${LEAD_COLUMNS},
        a.section, COALESCE(u.name, a.byline) AS byline, a.author_id, a.published_at,
        NULL AS category, NULL AS status, NULL AS venue, NULL AS starts_on, NULL AS ends_on, NULL AS start_time, NULL AS end_time, NULL AS hours_note,
        ${titleHits('a.headline')} AS title_hits, a.published_at AS sort_at
      FROM news_articles a LEFT JOIN "user" u ON u.id = a.author_id LEFT JOIN media m ON m.id = a.lead_media_id
      WHERE a.status = 'published' AND a.published_at <= ${nowParam}
        AND ${everyTerm(['a.headline', 'a.summary', 'a.body', 'a.community'])}
      UNION ALL
      SELECT 'event' AS kind, e.slug, e.title, e.summary, e.community, ${LEAD_COLUMNS},
        NULL, NULL, NULL, NULL,
        e.category, e.status, e.venue, e.starts_on, e.ends_on, e.start_time, e.end_time, e.hours_note,
        ${titleHits('e.title')}, unixepoch(e.starts_on) * 1000
      FROM events e LEFT JOIN media m ON m.id = e.image_media_id
      WHERE e.status IN ('published', 'cancelled')
        AND ${everyTerm(['e.title', 'e.summary', 'e.description', 'e.community'])}`;
  const values = [...terms.map(likePattern), now];
  const [count, rows] = await env.DB.batch<{ total: number } | (SearchResult & { title_hits: number; sort_at: number })>([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM (${matches})`).bind(...values),
    env.DB.prepare(`SELECT * FROM (${matches}) ORDER BY title_hits DESC, sort_at DESC, slug LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}`)
      .bind(...values, pageSize, page * pageSize),
  ]);
  const total = Number((count.results[0] as { total: number } | undefined)?.total ?? 0);
  const results = (rows.results as (SearchResult & { title_hits: number; sort_at: number })[])
    .map(({ title_hits: _hits, sort_at: _sort, ...row }) => row as SearchResult);
  return { results, total };
}
