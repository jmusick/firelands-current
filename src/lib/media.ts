import { env } from 'cloudflare:workers';
import { cleanText } from './forum';

// The media library. Every uploaded image gets a row here and a file in the MEDIA R2 bucket.
// Stories and ads point at library items; the library owns the files, so only deleting an unused
// item from the library removes its file.

export type MediaRecord = {
  id: string; object_key: string; content_type: string; width: number; height: number; bytes: number;
  filename: string; alt: string; decorative: number; caption: string; credit: string; source: string;
  uploaded_by: string | null; created_at: number; updated_at: number;
};

/** What the picker and the editor need to place an image. */
export type MediaItem = {
  id: string; url: string; width: number; height: number; filename: string;
  alt: string; decorative: boolean; caption: string; credit: string;
};

export const mediaUrl = (key: string) => `/media/${key}`;
export const isMediaId = (value: string) => /^[\w-]{8,64}$/.test(value);
export const toItem = (m: MediaRecord): MediaItem => ({
  id: m.id, url: mediaUrl(m.object_key), width: m.width, height: m.height, filename: m.filename, alt: m.alt, decorative: m.decorative === 1, caption: m.caption, credit: m.credit,
});

// The browser shrinks photos before upload, so real uploads land far under this.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 8000;
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Reads an image's real type and pixel size from its header, ignoring the file name and claimed type. */
export function imageInfo(b: Uint8Array): { type: string; width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length < 30) return null;
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return { type: 'image/png', width: u32(16), height: u32(20) };
  if (ascii(0, 4) === 'GIF8') return { type: 'image/gif', width: le16(6), height: le16(8) };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { type: 'image/webp', width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === 'VP8 ') return { type: 'image/webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (chunk === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { type: 'image/webp', width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'image/jpeg', width: u16(i + 7), height: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

/**
 * Drops a JPEG's EXIF/XMP (APP1) and IPTC (APP13) segments, where phones put GPS location.
 * The browser already re-encodes photos before upload; this catches any file that skipped that step.
 */
function stripJpegMetadata(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  // Segments run until start-of-scan (0xDA); everything after it is image data.
  while (i + 4 <= b.length && b[i] === 0xff && b[i + 1] !== 0xda) {
    const end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (b[i + 1] !== 0xe1 && b[i + 1] !== 0xed) parts.push(b.subarray(i, end));
    i = end;
  }
  parts.push(b.subarray(i));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export type CheckedImage = { bytes: Uint8Array<ArrayBuffer>; type: string; ext: string; width: number; height: number };

export async function checkUpload(file: File, maxBytes = MAX_UPLOAD_BYTES, label = 'Image'): Promise<CheckedImage | string> {
  if (file.size > maxBytes) return `${label} must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  let bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) return `${label} must be a PNG, JPEG, GIF or WebP file.`;
  if (!info.width || !info.height || info.width > MAX_EDGE || info.height > MAX_EDGE) return `${label} is too large; keep it under ${MAX_EDGE} pixels on each side.`;
  if (info.type === 'image/jpeg') bytes = stripJpegMetadata(bytes);
  return { bytes, type: info.type, ext: IMAGE_TYPES[info.type], width: info.width, height: info.height };
}

// `decorative` is the editor's explicit choice that the image adds nothing a reader would miss, so it
// renders with an empty alt. A decorative image never carries alt text.
export type MediaDetails = { alt: string; decorative: boolean; caption: string; credit: string; source: string };

export function detailsFrom(form: FormData): MediaDetails {
  const decorative = ['on', '1', 'true'].includes(cleanText(form.get('decorative')));
  return { alt: cleanText(form.get('alt')), decorative, caption: cleanText(form.get('caption')), credit: cleanText(form.get('credit')), source: cleanText(form.get('source')) };
}

// Alt text that says nothing: a placeholder word or a file name.
const PLACEHOLDER_ALT = /^(image|photo|picture|pic|img|graphic|logo|screenshot|untitled|alt( text)?)\.?$/i;
const FILE_NAME_ALT = /\.(png|jpe?g|gif|webp)$/i;

/** Whether an image still lacks an editorial decision: no alt text and not marked decorative. */
export const needsAltDecision = (m: { alt: string; decorative: number | boolean }) => !m.alt.trim() && !m.decorative;

export function validateDetails(d: MediaDetails): string[] {
  const errors: string[] = [];
  if (d.credit.length < 2 || d.credit.length > 120) errors.push('Credit is required (2–120 characters), e.g. “Photo by Jane Doe” or “Courtesy of Huron County”.');
  if (d.decorative && d.alt) errors.push('An image is either decorative or described: clear the alt text, or untick “This image is decorative”.');
  else if (!d.decorative && !d.alt) errors.push('Describe the image in the alt text, or tick “This image is decorative” if it adds nothing a reader would miss.');
  else if (!d.decorative && (PLACEHOLDER_ALT.test(d.alt) || FILE_NAME_ALT.test(d.alt))) errors.push('Alt text should describe what is in the image, not just name it (“photo”, a file name).');
  if (d.alt.length > 300) errors.push('Alt text must be under 300 characters.');
  if (d.caption.length > 500) errors.push('Caption must be under 500 characters.');
  if (d.source.length > 1000) errors.push('Source and permission must be under 1,000 characters.');
  return errors;
}

const cleanFilename = (name: string) => (name.split(/[\\/]/).pop() ?? '').replace(/[^\w .()-]+/g, '').trim().slice(0, 120) || 'image';

/**
 * Stores the file in R2 and returns the new record with the statement that saves it, so callers can
 * batch it with whatever uses the image. The file is written first; a failed batch leaves an orphan
 * file, which is harmless, rather than a record pointing at nothing.
 */
export async function storeMedia(image: CheckedImage, filename: string, details: MediaDetails, uploaderId: string | null) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const record: MediaRecord = {
    id, object_key: `library/${id}.${image.ext}`, content_type: image.type, width: image.width, height: image.height, bytes: image.bytes.length,
    filename: cleanFilename(filename), ...details, decorative: details.decorative ? 1 : 0, uploaded_by: uploaderId, created_at: now, updated_at: now,
  };
  await env.MEDIA.put(record.object_key, image.bytes, { httpMetadata: { contentType: image.type } });
  const statement = env.DB.prepare(`
    INSERT INTO media (id, object_key, content_type, width, height, bytes, filename, alt, decorative, caption, credit, source, uploaded_by, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
  `).bind(id, record.object_key, record.content_type, record.width, record.height, record.bytes, record.filename,
    record.alt, record.decorative, record.caption, record.credit, record.source, uploaderId, now);
  return { record, statement };
}

export function mediaAudit(actor: { id: string; name: string }, media: { id: string; filename: string }, action: string, detail?: string) {
  return env.DB.prepare(`
    INSERT INTO admin_audit_log (id, actor_id, actor_name, target_media_id, target_label, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), actor.id, actor.name, media.id, media.filename, action, detail ?? null, Date.now());
}

export const MEDIA_PAGE_SIZE = 48;
export const MEDIA_MAX_PAGE = 1000;

/** A zero-based page index from a query string: absent is page 0, anything not a plain whole number in range is null. */
export function parseMediaPage(raw: string | null): number | null {
  if (raw === null || raw === '') return 0;
  if (!/^\d{1,6}$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page <= MEDIA_MAX_PAGE ? page : null;
}

const NEEDS_ALT_SQL = "alt = '' AND decorative = 0";

/** `needsAlt` lists only images with no alt text and no decorative decision. */
export async function listMedia(q: string, page: number, needsAlt = false): Promise<MediaRecord[]> {
  if (!Number.isSafeInteger(page) || page < 0 || page > MEDIA_MAX_PAGE) page = 0;
  const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const result = await env.DB.prepare(`
    SELECT * FROM media
    WHERE (?1 = '' OR lower(filename || ' ' || alt || ' ' || caption || ' ' || credit) LIKE ?2 ESCAPE '\\')
      AND (?5 = 0 OR (${NEEDS_ALT_SQL}))
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?3 OFFSET ?4
  `).bind(q, like, MEDIA_PAGE_SIZE + 1, page * MEDIA_PAGE_SIZE, needsAlt ? 1 : 0).all<MediaRecord>();
  return result.results;
}

/** How many library images still need an alt text decision. */
export async function countNeedingAlt(): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM media WHERE ${NEEDS_ALT_SQL}`).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getMedia(id: string): Promise<(MediaRecord & { uploader_name: string | null }) | null> {
  if (!isMediaId(id)) return null;
  return env.DB.prepare('SELECT m.*, u.name AS uploader_name FROM media m LEFT JOIN "user" u ON u.id = m.uploaded_by WHERE m.id = ?')
    .bind(id).first();
}

export type MediaUsage = {
  stories: { id: string; headline: string; status: string; lead: number }[];
  ads: { id: string; name: string; size: string }[];
  events: { id: string; title: string; status: string }[];
};

/** Where an item runs: as a story's lead image, inside a story's text, as an ad banner, or with an event. */
export async function mediaUsage(media: { id: string; object_key: string }): Promise<MediaUsage> {
  const [stories, ads, events] = await env.DB.batch([
    env.DB.prepare('SELECT id, headline, status, lead_media_id = ?1 AS lead FROM news_articles WHERE lead_media_id = ?1 OR instr(body, ?2) > 0 ORDER BY updated_at DESC')
      .bind(media.id, mediaUrl(media.object_key)),
    env.DB.prepare('SELECT a.id, a.name, i.size FROM ad_images i JOIN ads a ON a.id = i.ad_id WHERE i.media_id = ? ORDER BY a.name').bind(media.id),
    env.DB.prepare('SELECT id, title, status FROM events WHERE image_media_id = ?1 OR instr(description, ?2) > 0 ORDER BY starts_on DESC')
      .bind(media.id, mediaUrl(media.object_key)),
  ]);
  return { stories: stories.results as MediaUsage['stories'], ads: ads.results as MediaUsage['ads'], events: events.results as MediaUsage['events'] };
}

export async function mediaAuditLog(id: string) {
  const result = await env.DB.prepare('SELECT action, detail, actor_name, created_at FROM admin_audit_log WHERE target_media_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 25')
    .bind(id).all<{ action: string; detail: string | null; actor_name: string; created_at: number }>();
  return result.results;
}

/** Library paths a story's Markdown points at, e.g. library/…jpg from ![…](/media/library/…jpg). */
export function mediaKeysIn(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\]\(\s*\/media\/([\w/.-]+)/g)].map((m) => m[1]))];
}

export async function mediaByKeys(keys: string[]): Promise<Map<string, MediaRecord>> {
  if (!keys.length) return new Map();
  const result = await env.DB.prepare(`SELECT * FROM media WHERE object_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<MediaRecord>();
  return new Map(result.results.map((m) => [m.object_key, m]));
}

export const fmtBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n ? `${Math.max(1, Math.round(n / 1024))} KB` : '—';
