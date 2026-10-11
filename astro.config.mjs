import { readFileSync } from 'node:fs';
import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  output: 'server',
  session: { driver: sessionDrivers.lruCache() },
  adapter: cloudflare({ imageService: 'compile' }),
  // The Content Security Policy (src/lib/response-headers.ts) admits no inline <style>, and inline
  // scripts only with a nonce the middleware can give only to /_astro/ files, so nothing is inlined.
  build: { inlineStylesheets: 'never' },
  vite: {
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined) },
  },
});
