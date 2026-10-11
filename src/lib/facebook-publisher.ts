import { campaignUrl, FACEBOOK_STORY_SHARE } from './campaign.ts';

export type FacebookConfig = {
  DB: D1Database;
  SITE_URL: string;
  FACEBOOK_AUTO_POST_ENABLED?: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_GRAPH_VERSION?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  FACEBOOK_TOKEN_EXPIRES_AT?: string;
};

export type FacebookStatus = 'review' | 'pending' | 'posting' | 'posted' | 'failed' | 'uncertain';
export const FACEBOOK_STATUS_LABELS: Record<FacebookStatus, string> = {
  review: 'Archive review', pending: 'Queued', posting: 'Sending', posted: 'Posted', failed: 'Needs attention', uncertain: 'Check Facebook',
};
const MAX_ATTEMPTS = 6;
const LEASE_MS = 5 * 60_000;

export function facebookConnectionIssue(config: FacebookConfig, now = Date.now()): string | null {
  if (!config.FACEBOOK_PAGE_ACCESS_TOKEN) return 'The Facebook Page access token is missing.';
  if (!/^\d+$/.test(config.FACEBOOK_PAGE_ID ?? '')) return 'The Facebook Page ID is missing or invalid.';
  if (!/^v\d+\.\d+$/.test(config.FACEBOOK_GRAPH_VERSION ?? '')) return 'The Facebook API version is missing or invalid.';
  if (config.SITE_URL !== 'https://firelandscurrent.com') return 'Posting requires the production site URL.';
  const expiresAt = Number(config.FACEBOOK_TOKEN_EXPIRES_AT);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return 'Record the verified token expiration before enabling posting.';
  if (expiresAt <= now) return 'The Facebook Page access token has expired. Renew it before retrying.';
  return null;
}

export function facebookPostUrl(postId: string): string {
  return `https://www.facebook.com/${postId}`;
}

/** Recovery scan is unbounded by feed size: stories cannot fall out of an RSS window. */
export async function reconcileFacebookPosts(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO facebook_posts (article_id, status, next_attempt_at, created_at, updated_at)
    SELECT id, 'pending', ?, ?, ? FROM news_articles WHERE status = 'published'`).bind(now, now, now).run();
  // A lost response may still mean Facebook published the story. Never automatically send it twice.
  await db.prepare(`UPDATE facebook_posts SET status = 'uncertain', claim_id = NULL,
    last_error = 'The sending attempt did not finish. Check the Page before retrying.', updated_at = ?
    WHERE status = 'posting' AND started_at <= ?`).bind(now, now - LEASE_MS).run();
}

type Claim = { article_id: string; attempts: number };
type Story = { slug: string; headline: string; summary: string; status: string; published_at: number | null };
type GraphResult = { id?: unknown; error?: { code?: unknown; error_subcode?: unknown; is_transient?: unknown } };

async function finish(config: FacebookConfig, claim: Claim, claimId: string, status: FacebookStatus, error: string | null, now: number, postId: string | null = null) {
  await config.DB.prepare(`UPDATE facebook_posts SET status = ?, last_error = ?, claim_id = NULL,
    next_attempt_at = ?, updated_at = ?, post_id = COALESCE(?, post_id), posted_at = CASE WHEN ? IS NOT NULL THEN ? ELSE posted_at END
    WHERE article_id = ? AND status = 'posting' AND claim_id = ?`)
    .bind(status, error, now + Math.min(60 * 60_000, 60_000 * 2 ** claim.attempts), now, postId, postId, now, claim.article_id, claimId).run();
}

/** Uses an atomic database claim so overlapping cron invocations cannot send the same story. */
export async function publishFacebookStories(config: FacebookConfig, options: { now?: () => number; fetch?: typeof fetch } = {}) {
  const clock = options.now ?? Date.now;
  const send = options.fetch ?? fetch;
  const now = clock();
  await config.DB.prepare('UPDATE facebook_publisher_health SET last_run_at = ?, last_error = NULL WHERE id = 1').bind(now).run();
  await reconcileFacebookPosts(config.DB, now);
  if (config.FACEBOOK_AUTO_POST_ENABLED !== 'true') return { posted: 0, paused: true };
  const issue = facebookConnectionIssue(config, now);
  if (issue) {
    await config.DB.prepare('UPDATE facebook_publisher_health SET last_error = ? WHERE id = 1').bind(issue).run();
    return { posted: 0, paused: true };
  }

  // Verify identity on every run, before any write to Meta. A misconfigured token cannot post to another Page.
  let identity: { id?: string; can_post?: boolean };
  let identityIssue = 'The Page identity or posting permission did not match.';
  try {
    const response = await send(`https://graph.facebook.com/${config.FACEBOOK_GRAPH_VERSION}/me?fields=id,can_post`, {
      headers: { Authorization: `Bearer ${config.FACEBOOK_PAGE_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(15_000), redirect: 'manual',
    });
    const data = await response.json() as { id?: string; can_post?: boolean; error?: { code?: unknown } } | null;
    if (!response.ok) {
      const code = typeof data?.error?.code === 'number' ? data.error.code : 'unknown';
      identityIssue = `Facebook identity check returned HTTP ${response.status}, code ${code}.`;
    }
    identity = data && typeof data === 'object' ? data : {};
  } catch { identity = {}; identityIssue = 'The Facebook identity request failed or returned an unreadable response.'; }
  if (identity.id !== config.FACEBOOK_PAGE_ID || identity.can_post !== true) {
    await config.DB.prepare('UPDATE facebook_publisher_health SET last_error = ? WHERE id = 1')
      .bind(`Facebook could not confirm this token can post to the configured Page. ${identityIssue}`).run();
    return { posted: 0, paused: true };
  }

  let posted = 0;
  for (let i = 0; i < 5; i++) {
    const claimId = crypto.randomUUID();
    const startedAt = clock();
    const claim = await config.DB.prepare(`UPDATE facebook_posts SET status = 'posting', claim_id = ?,
      started_at = ?, updated_at = ?, attempts = attempts + 1, page_id = ?
      WHERE article_id = (SELECT p.article_id FROM facebook_posts p JOIN news_articles a ON a.id = p.article_id
        WHERE p.status = 'pending' AND p.next_attempt_at <= ? AND a.status = 'published' AND a.published_at <= ?
        ORDER BY a.published_at, p.article_id LIMIT 1) AND status = 'pending'
      RETURNING article_id, attempts`).bind(claimId, startedAt, startedAt, config.FACEBOOK_PAGE_ID!, startedAt, startedAt).first<Claim>();
    if (!claim) break;
    const story = await config.DB.prepare('SELECT slug, headline, summary, status, published_at FROM news_articles WHERE id = ?')
      .bind(claim.article_id).first<Story>();
    if (!story || story.status !== 'published' || (story.published_at ?? Infinity) > clock()) {
      await finish(config, claim, claimId, 'pending', null, clock());
      continue;
    }
    const articleUrl = `${config.SITE_URL}/news/${encodeURIComponent(story.slug)}`;
    // The ledger keeps the canonical URL; only the link sent to Facebook carries UTM tags.
    const link = campaignUrl(articleUrl, FACEBOOK_STORY_SHARE);
    await config.DB.prepare('UPDATE facebook_posts SET article_url = ? WHERE article_id = ? AND claim_id = ?').bind(articleUrl, claim.article_id, claimId).run();
    let response: Response;
    let result: GraphResult;
    try {
      response = await send(`https://graph.facebook.com/${config.FACEBOOK_GRAPH_VERSION}/${config.FACEBOOK_PAGE_ID}/feed`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.FACEBOOK_PAGE_ACCESS_TOKEN}` },
        body: new URLSearchParams({ message: `${story.headline}\n\n${story.summary}`, link }),
        signal: AbortSignal.timeout(20_000), redirect: 'manual',
      });
      const data = await response.json();
      result = data && typeof data === 'object' ? data : {};
    } catch {
      const error = 'Facebook did not return a readable result. Check the Page before retrying.';
      await finish(config, claim, claimId, 'uncertain', error, clock());
      await config.DB.prepare('UPDATE facebook_publisher_health SET last_error = ? WHERE id = 1').bind(error).run();
      break;
    }
    if (response.ok && typeof result.id === 'string' && new RegExp(`^${config.FACEBOOK_PAGE_ID}_\\d+$`).test(result.id)) {
      // If this write fails, the lease becomes uncertain. Replaying the POST is never the recovery path.
      await finish(config, claim, claimId, 'posted', null, clock(), result.id);
      posted++;
      continue;
    }
    const code = typeof result.error?.code === 'number' ? result.error.code : null;
    const subcode = typeof result.error?.error_subcode === 'number' ? result.error.error_subcode : null;
    const error = code === null ? 'Facebook returned an unexpected result. Check the Page before retrying.'
      : `Facebook rejected the post (code ${code}${subcode === null ? '' : `, subcode ${subcode}`}).`;
    // Raw error messages may echo credentials. Store numeric codes and our own descriptions only.
    const uncertain = response.status >= 500 || response.ok || code === null;
    const retryable = !uncertain && (response.status === 429 || [4, 17, 32, 613].includes(code!));
    const status = uncertain ? 'uncertain' : retryable && claim.attempts < MAX_ATTEMPTS ? 'pending' : 'failed';
    await finish(config, claim, claimId, status, error, clock());
    await config.DB.prepare('UPDATE facebook_publisher_health SET last_error = ? WHERE id = 1').bind(error).run();
    // Stop this run on rate limits or permission failures instead of repeatedly hitting Meta.
    if (uncertain || retryable || [10, 190, 200].includes(code!)) break;
  }
  await config.DB.prepare('UPDATE facebook_publisher_health SET last_success_at = ? WHERE id = 1').bind(clock()).run();
  console.log(JSON.stringify({ event: 'facebook_publisher_run', posted }));
  return { posted, paused: false };
}
