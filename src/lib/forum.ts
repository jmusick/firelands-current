import { env } from 'cloudflare:workers';

/** The account that starts every story's discussion. It has no sign-in and is left out of user lists and counts. */
export const NEWSROOM_USER_ID = 'newsroom';

export type Thread = {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  body: string;
  created_at: number;
  last_activity_at: number;
  reply_count: number;
  score: number;
  /** The viewer's own vote: 1, -1, or 0 for none (also 0 when signed out). */
  my_vote: number;
  kind: ThreadKind;
  /** The story or event this discussion belongs to, e.g. /news/some-story; null for community discussions. Title and body then come from it. */
  source_path: string | null;
};

/** What a discussion is about: a news story, a calendar event, or a topic a reader started. */
export type ThreadKind = 'story' | 'event' | 'community';
export const THREAD_KINDS: Record<ThreadKind, string> = { story: 'Stories', event: 'Events', community: 'Community' };
export const KIND_LABELS: Record<ThreadKind, string> = { story: 'Story discussion', event: 'Event discussion', community: 'Discussion' };

export function threadKind(value: string | null): ThreadKind | null {
  return value === 'story' || value === 'event' || value === 'community' ? value : null;
}

export type Reply = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: number;
  score: number;
  my_vote: number;
};

export type ReplySort = 'top' | 'new' | 'old';
export const REPLY_SORTS: Record<ReplySort, string> = { top: 'Top', new: 'Newest', old: 'Oldest' };

export function replySort(value: string | null): ReplySort {
  return value === 'new' || value === 'old' ? value : 'top';
}

// A story's or event's discussion is only visible while it is (an event may be cancelled but not a draft). ?1 is the viewer's id ('' when signed out).
const THREAD_SELECT = `
  SELECT t.id, t.author_id, u.name AS author_name,
         COALESCE(a.headline, ev.title, t.title) AS title, COALESCE(a.summary, ev.summary, t.body) AS body,
         t.created_at, t.last_activity_at,
         CASE WHEN t.article_id IS NOT NULL THEN 'story' WHEN t.event_id IS NOT NULL THEN 'event' ELSE 'community' END AS kind,
         COALESCE('/news/' || a.slug, '/events/' || ev.slug) AS source_path,
         (SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id = t.id AND r.status = 'published') AS reply_count,
         COALESCE((SELECT SUM(v.value) FROM forum_thread_votes v WHERE v.thread_id = t.id), 0) AS score,
         COALESCE((SELECT v.value FROM forum_thread_votes v WHERE v.thread_id = t.id AND v.user_id = ?1), 0) AS my_vote
  FROM forum_threads t
  JOIN "user" u ON u.id = t.author_id
  LEFT JOIN news_articles a ON a.id = t.article_id
  LEFT JOIN events ev ON ev.id = t.event_id
  WHERE t.status = 'published' AND (t.article_id IS NULL OR a.status = 'published') AND (t.event_id IS NULL OR ev.status != 'draft')`;

/**
 * One page of discussions, newest activity first. Every story and event gets an automatic discussion, so the
 * unfiltered list leaves out the ones nobody has replied to (a thread whose only replies are hidden counts as
 * none) and leads with community topics and discussed stories or events. A kind tab still lists every visible
 * discussion of that kind. The filter is in SQL so pages stay full, and id breaks ties so paging stays stable.
 */
export async function listThreads(page = 0, viewerId = '', kind: ThreadKind | null = null): Promise<Thread[]> {
  const result = await env.DB.prepare(`SELECT * FROM (${THREAD_SELECT})
    WHERE (?3 IS NULL AND (kind = 'community' OR reply_count > 0)) OR kind = ?3
    ORDER BY last_activity_at DESC, id DESC
    LIMIT 21 OFFSET ?2
  `).bind(viewerId, page * 20, kind).all<Thread>();
  return result.results;
}

export async function getThread(id: string, viewerId = ''): Promise<Thread | null> {
  return env.DB.prepare(`${THREAD_SELECT} AND t.id = ?2`).bind(viewerId, id).first<Thread>();
}

/** The discussion attached to a published story, or null if a moderator has hidden it. */
export async function getArticleThread(articleId: string, viewerId = ''): Promise<Thread | null> {
  return env.DB.prepare(`${THREAD_SELECT} AND t.article_id = ?2`).bind(viewerId, articleId).first<Thread>();
}

/** The discussion attached to a visible event, or null if a moderator has hidden it. */
export async function getEventThread(eventId: string, viewerId = ''): Promise<Thread | null> {
  return env.DB.prepare(`${THREAD_SELECT} AND t.event_id = ?2`).bind(viewerId, eventId).first<Thread>();
}

/** How many levels of replies to replies are allowed; a comment at this depth has no Reply button. */
export const MAX_REPLY_DEPTH = 5;
/** Top-level comments shown per page, each with all of its replies. */
export const COMMENTS_PER_PAGE = 50;

export type Comment = Reply & {
  /** 0 for a comment on the discussion itself, 1 for a reply to it, and so on. */
  depth: number;
  /** A hidden comment kept in place only because visible replies hang below it. */
  removed: boolean;
};

type CommentRow = Reply & { parent_id: string | null; status: 'published' | 'hidden' };

// Ties always fall back to id so equal scores or timestamps keep a stable order between page loads.
const byOrder: Record<ReplySort, (a: CommentRow, b: CommentRow) => number> = {
  top: (a, b) => b.score - a.score || a.created_at - b.created_at || (a.id < b.id ? -1 : 1),
  new: (a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1),
  old: (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1),
};

const ROOT_ORDER: Record<ReplySort, string> = {
  top: 'score DESC, r.created_at ASC, r.id ASC',
  new: 'r.created_at DESC, r.id DESC',
  old: 'r.created_at ASC, r.id ASC',
};

const COMMENT_COLUMNS = `r.id, r.parent_id, r.status, r.author_id, u.name AS author_name, r.body, r.created_at,
  COALESCE((SELECT SUM(v.value) FROM forum_reply_votes v WHERE v.reply_id = r.id), 0) AS score,
  COALESCE((SELECT v.value FROM forum_reply_votes v WHERE v.reply_id = r.id AND v.user_id = ?1), 0) AS my_vote`;

// Every comment under a top-level comment, tagged with that top-level comment's id.
const SUBTREE = `RECURSIVE tree(root_id, id, status) AS (
  SELECT id, id, status FROM forum_replies WHERE thread_id = ?2 AND parent_id IS NULL
  UNION ALL
  SELECT t.root_id, r.id, r.status FROM forum_replies r JOIN tree t ON r.parent_id = t.id WHERE r.thread_id = ?2
)`;

// A top-level comment is shown if it, or anything beneath it, is published.
const VISIBLE_ROOT = `r.thread_id = ?2 AND r.parent_id IS NULL
  AND EXISTS (SELECT 1 FROM tree t WHERE t.root_id = r.id AND t.status = 'published')`;

/**
 * One page of a discussion's comments as a flat list in display order (each comment followed by its replies,
 * with its depth), plus the number of top-level comments for paging. Top-level comments are ordered and paged
 * in SQL, then only the replies beneath that page are loaded, so nothing is dropped however large the discussion
 * grows. Hidden comments are dropped unless visible replies sit below them.
 */
export async function listComments(threadId: string, page = 0, sort: ReplySort = 'top', viewerId = ''): Promise<{ comments: Comment[]; rootCount: number }> {
  if (!Number.isSafeInteger(page) || page < 0) page = 0;
  const [rootRows, count] = await Promise.all([
    env.DB.prepare(`
      WITH ${SUBTREE}
      SELECT ${COMMENT_COLUMNS}
      FROM forum_replies r JOIN "user" u ON u.id = r.author_id
      WHERE ${VISIBLE_ROOT}
      ORDER BY ${ROOT_ORDER[sort]}
      LIMIT ?3 OFFSET ?4
    `).bind(viewerId, threadId, COMMENTS_PER_PAGE, page * COMMENTS_PER_PAGE).all<CommentRow>(),
    env.DB.prepare(`
      WITH ${SUBTREE}
      SELECT COUNT(*) AS n FROM forum_replies r WHERE ${VISIBLE_ROOT}
    `).bind(viewerId, threadId).first<{ n: number }>(),
  ]);
  const roots = rootRows.results;
  const rootCount = count?.n ?? 0;
  if (!roots.length) return { comments: [], rootCount };

  const descendants = await env.DB.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM forum_replies WHERE thread_id = ?2 AND parent_id IN (SELECT value FROM json_each(?3))
      UNION ALL
      SELECT r.id FROM forum_replies r JOIN tree t ON r.parent_id = t.id WHERE r.thread_id = ?2
    )
    SELECT ${COMMENT_COLUMNS}
    FROM forum_replies r JOIN "user" u ON u.id = r.author_id
    WHERE r.id IN (SELECT id FROM tree)
  `).bind(viewerId, threadId, JSON.stringify(roots.map((r) => r.id))).all<CommentRow>();

  const children = new Map<string, CommentRow[]>();
  for (const row of descendants.results) {
    if (row.parent_id) children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row]);
  }
  // A hidden comment stays as a placeholder only while a visible reply is below it.
  const visible = new Map<string, boolean>();
  const hasVisible = (row: CommentRow): boolean => {
    if (!visible.has(row.id)) visible.set(row.id, row.status === 'published' || (children.get(row.id) ?? []).some(hasVisible));
    return visible.get(row.id)!;
  };
  const comments: Comment[] = [];
  const walk = (row: CommentRow, depth: number) => {
    const removed = row.status === 'hidden';
    comments.push({ id: row.id, author_id: row.author_id, author_name: removed ? '' : row.author_name, body: removed ? '' : row.body, created_at: row.created_at, score: row.score, my_vote: row.my_vote, depth, removed });
    for (const child of (children.get(row.id) ?? []).filter(hasVisible).sort(byOrder[sort])) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return { comments, rootCount };
}

/** Creates a story's discussion if it doesn't have one yet; called whenever a story is saved as published. */
export async function ensureArticleThread(article: { id: string; headline: string; summary: string; published_at: number }): Promise<void> {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO forum_threads (id, author_id, title, body, article_id, created_at, updated_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), NEWSROOM_USER_ID, article.headline, article.summary, article.id,
    article.published_at, article.published_at, article.published_at).run();
}

/** Creates an event's discussion if it doesn't have one yet; called whenever an event is saved as published or cancelled. */
export async function ensureEventThread(event: { id: string; title: string; summary: string }): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO forum_threads (id, author_id, title, body, event_id, created_at, updated_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), NEWSROOM_USER_ID, event.title, event.summary, event.id, now, now, now).run();
}

/**
 * Where to send the reader after a comment, vote or report: the page they were on if it's this discussion's
 * page or its story's or event's page (query string kept for sort and page), otherwise the discussion page.
 */
export function returnPathFor(requested: string, thread: { id: string; source_path: string | null }): string {
  const fallback = `/talk/${thread.id}`;
  if (!/^\/(?:talk\/[0-9a-f-]{36}|(?:news|events)\/[a-z0-9-]{1,120})(?:\?[A-Za-z0-9=&_-]{0,80})?$/.test(requested)) return fallback;
  const path = requested.split('?')[0];
  return path === fallback || (thread.source_path !== null && path === thread.source_path) ? requested : fallback;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

export function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function redirectWithError(request: Request, path: string, error: string, hash = ''): Response {
  const url = new URL(path, request.url);
  url.searchParams.set('error', error);
  url.hash = hash;
  return Response.redirect(url, 303);
}
