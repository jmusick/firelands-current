import { handle } from '@astrojs/cloudflare/handler';
import { pruneAuthRateLimits } from './lib/auth-rate-limit';
import { publishFacebookStories } from './lib/facebook-publisher';
import { runTipRetention } from './lib/tip-retention';

export default {
  fetch: handle,
  async scheduled(_controller, env) {
    // Separate from the publisher so a failure in one never skips the other.
    await pruneAuthRateLimits(env.DB).catch(() => console.error(JSON.stringify({ event: 'auth_rate_limit_prune_failed' })));
    // Does its work once a day; the other runs return after one cheap claim query.
    await runTipRetention(env.DB).catch(() => console.error(JSON.stringify({ event: 'tip_retention_failed' })));
    try {
      await publishFacebookStories(env);
    } catch {
      console.error(JSON.stringify({ event: 'facebook_publisher_failed' }));
      await env.DB.prepare('UPDATE facebook_publisher_health SET last_error = ? WHERE id = 1')
        .bind('The publisher stopped unexpectedly. Check Worker logs and any unfinished posts.').run();
      throw new Error('Facebook publisher failed');
    }
  },
} satisfies ExportedHandler<Env>;
