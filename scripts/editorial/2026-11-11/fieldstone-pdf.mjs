import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { editorialDirectory } from '../../project-library.mjs';

const dir = editorialDirectory('2026-11-11') + 'fieldstone/';
const source = dir + 'Fieldstone_Post_Event_Release.pdf';
const filename = 'fieldstone-press-release-2026-11-10.pdf';
const url = '/downloads/' + filename;
const link = `[Download Fieldstone’s original news release (PDF, 2 pages, 743 KB)](${url})`;
const bytes = readFileSync(source);
assert(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
mkdirSync('public/downloads', { recursive: true });
copyFileSync(source, 'public/downloads/' + filename);

// This changes only the local article. Deploying the PDF and syncing the article are separate publisher actions.
const proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: { path: '.wrangler/state/v3' }, remoteBindings: false });
try {
  const db = proxy.env.DB;
  const article = await db.prepare('SELECT * FROM news_articles WHERE slug=?').bind('fieldstone-fostoria-new-name-renovations').first();
  assert(article);
  const actor = await db.prepare('SELECT id,name FROM user WHERE email=?').bind('jd@orboro.net').first();
  assert.equal(actor?.name, 'JD');
  if (!article.body.includes(url)) {
    const now = Date.now();
    const result = await db.batch([
      db.prepare('UPDATE news_articles SET body=?,updated_at=? WHERE id=? AND updated_at=?').bind(article.body + '\n\n' + link, now, article.id, article.updated_at),
      db.prepare("INSERT INTO admin_audit_log (id,actor_id,actor_name,target_type,target_id,target_label,action,detail,outcome,created_at) VALUES (?,?,?,'story',?,?,'story-update',?,'success',?)")
        .bind(randomUUID(), actor.id, actor.name, article.id, article.headline, 'Added publisher-requested original press release PDF link in local dev.', now),
    ]);
    assert.equal(result[0].meta.changes, 1);
  }
  const saved = await db.prepare('SELECT body FROM news_articles WHERE id=?').bind(article.id).first();
  assert(saved.body.includes(link));
  writeFileSync(dir + 'pdf-attachment.json', JSON.stringify({ target: 'local', article_id: article.id, public_url: url, source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), link, added_at: new Date().toISOString() }, null, 2) + '\n');
  console.log('Added original PDF link to local Fieldstone article.');
} finally { await proxy.dispose(); }
