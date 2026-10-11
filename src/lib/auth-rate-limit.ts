import type { BetterAuthOptions } from 'better-auth';

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions['rateLimit']>['customStorage']>;

/**
 * A counter whose window began this long ago has expired under every rule Better Auth applies (the
 * longest is 60 seconds) and every public-write quota in quotas.ts (the longest is one hour), so the
 * scheduled Worker deletes it. The privacy policy quotes this retention.
 */
export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000;

/**
 * Better Auth rate-limit counters in D1, so every Worker isolate shares one count per client IP and
 * auth path. The default in-memory store is per isolate and resets whenever an isolate is replaced.
 *
 * A single upsert starts, resets, or increments the fixed window and returns the result, so
 * concurrent requests from any isolate are serialized by the database and none can pass on a stale
 * read. Refused requests still count but never move the window, so being throttled ends `window`
 * seconds after it began, however hard a client keeps trying.
 */
export function d1RateLimitStorage(db: D1Database): RateLimitStorage {
  return {
    async consume(key, rule) {
      const now = Date.now();
      const windowMs = rule.window * 1000;
      const row = await consumeRateWindow(db, key, windowMs, now);
      if (row.count <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((row.windowStart + windowMs - now) / 1000)) };
    },
  };
}

/**
 * Counts one hit against `key` in a fixed window of `windowMs` and returns the running count. One upsert
 * starts, resets, or increments the window, so concurrent callers are serialized by the database. The
 * public-write quotas in quotas.ts count in the same table with this same statement.
 */
export async function consumeRateWindow(db: D1Database, key: string, windowMs: number, now = Date.now()): Promise<{ count: number; windowStart: number }> {
  const row = await db.prepare(`INSERT INTO auth_rate_limits (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN excluded.window_start - auth_rate_limits.window_start >= ? THEN 1 ELSE auth_rate_limits.count + 1 END,
      window_start = CASE WHEN excluded.window_start - auth_rate_limits.window_start >= ? THEN excluded.window_start ELSE auth_rate_limits.window_start END
    RETURNING count, window_start`)
    .bind(key, now, windowMs, windowMs).first<{ count: number; window_start: number }>();
  if (!row) throw new Error('Rate-limit upsert returned no row');
  return { count: row.count, windowStart: row.window_start };
}

/** Deletes counters too old to matter, so client IPs aren't kept longer than throttling needs them. */
export async function pruneAuthRateLimits(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM auth_rate_limits WHERE window_start < ?').bind(now - RATE_LIMIT_RETENTION_MS).run();
}
