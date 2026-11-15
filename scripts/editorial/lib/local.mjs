// The local database and media bucket, through Wrangler's platform proxy, plus the site's own audit and media
// modules so packet writes produce exactly the rows the admin panel would.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { getPlatformProxy } from 'wrangler';
import { repositoryDirectory } from '../../project-library.mjs';

export const TABLES = ['news_articles', 'events', 'forum_threads', 'media', 'facebook_posts', 'admin_audit_log'];
export const DEFAULT_STATE = join(repositoryDirectory, '.wrangler', 'state');
export const rowKey = row => row.id ?? row.article_id;

export async function openLocal(stateDir = DEFAULT_STATE) {
  const proxy = await getPlatformProxy({ configPath: join(repositoryDirectory, 'wrangler.jsonc'), persist: { path: join(resolve(stateDir), 'v3') }, remoteBindings: false });
  try { assert.equal(proxy.env.FACEBOOK_AUTO_POST_ENABLED, 'false', 'Local Facebook delivery must remain disabled'); }
  catch (error) { await proxy.dispose(); throw error; }
  const binding = '__editorialPacketEnv_' + randomUUID().replaceAll('-', '');
  globalThis[binding] = proxy.env;
  const envModule = `data:text/javascript,export const env=globalThis[${JSON.stringify(binding)}];`;
  const modules = new Map();
  // The site modules import `env` from cloudflare:workers; hand them the proxy's bindings instead.
  function sourceModule(name, replacements = {}) {
    if (modules.has(name)) return modules.get(name);
    let source = ts.transpileModule(readFileSync(join(repositoryDirectory, 'src', 'lib', name + '.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
    source = source.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => {
      const mapped = specifier === 'cloudflare:workers' ? envModule : replacements[specifier];
      if (mapped) return `from ${JSON.stringify(mapped)}`;
      assert(!specifier.startsWith('.'), `Unmapped relative import ${specifier} in src/lib/${name}.ts`);
      return `from ${JSON.stringify(import.meta.resolve(specifier))}`;
    });
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    modules.set(name, url);
    return url;
  }
  const db = proxy.env.DB;
  return {
    proxy, db, env: proxy.env,
    audit: () => import(sourceModule('audit')),
    media: () => import(sourceModule('media', { './forum': sourceModule('forum') })),
    snapshot: async () => Object.fromEntries(await Promise.all(TABLES.map(async table => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results]))),
    dispose: async () => { delete globalThis[binding]; await proxy.dispose(); },
  };
}

export function insertStatement(db, table, row) {
  return db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
}
