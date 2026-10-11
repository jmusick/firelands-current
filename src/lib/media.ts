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

// ---- Metadata stripping ----
//
// The browser redraws photos before upload, which drops their metadata, but GIFs skip that step and a
// direct API upload skips the browser entirely. So the server rebuilds every file from an allowlist of the
// parts a browser needs to draw it, dropping camera data, GPS location, captions, comments, edit history,
// embedded thumbnails and anything appended after the image. Pixels are copied untouched; there is no
// decoder in the Workers runtime, and none is needed to remove whole metadata blocks.
//
// Colour profiles (ICC) are kept in every format: they change how the pixels look (a phone's Display P3
// photo turns dull without one), and they describe a colour space, not the photo, the person or the place.
//
// Each parser checks every length against the bytes actually present, always moves forward, and returns
// null for anything it can't follow to its proper end; a file it can't read is refused, never passed through.

const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * JPEG keeps its decoding segments (tables, frame, scans), APP0 JFIF without its thumbnail, APP2 ICC
 * profiles and APP14 Adobe (which says how to read the colour channels). It drops APP1 EXIF/XMP (where
 * phones put GPS location), APP13 IPTC/Photoshop, comments, every other APPn (maker notes, FlashPix,
 * multi-picture indexes) and anything after the end-of-image marker, where phones append depth maps,
 * HDR gain maps and motion-photo video.
 */
function stripJpeg(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const n = b.length;
  if (n < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2, frame = false, scans = 0;
  for (;;) {
    if (i >= n || b[i] !== 0xff) return null;
    while (i < n && b[i] === 0xff) i++; // fill bytes may pad any marker
    if (i >= n) return null;
    const marker = b[i];
    const start = i - 1;
    if (marker === 0xd9) {
      if (!scans) return null;
      parts.push(b.subarray(start, i + 1));
      return concat(parts);
    }
    // Standalone markers (SOI again, restarts, TEM) and stuffed zeros don't belong between segments.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) return null;
    if (i + 3 > n) return null;
    const length = be16(b, i + 1);
    const end = i + 1 + length;
    if (length < 2 || end > n) return null;
    const body = b.subarray(i + 3, end);
    i = end;
    if (marker === 0xda) {
      if (!frame) return null;
      parts.push(b.subarray(start, end));
      // Entropy-coded data runs to the next marker; FF00 is an escaped byte and FFD0–FFD7 are restarts.
      let j = end;
      for (;;) {
        j = b.indexOf(0xff, j);
        if (j < 0 || j + 1 >= n) return null;
        const next = b[j + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) j += 2;
        else if (next === 0xff) j += 1;
        else break;
      }
      parts.push(b.subarray(end, j));
      scans++;
      i = j;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) frame = true;
    if (marker === 0xe0) {
      // JFIF's 14-byte header, with the optional thumbnail size set to zero and its pixels left behind.
      if (body.length >= 14 && ascii(body, 0, 5) === 'JFIF\0') parts.push(new Uint8Array([0xff, 0xe0, 0, 16, ...body.subarray(0, 12), 0, 0]));
    } else if (marker === 0xe2) {
      if (ascii(body, 0, 12) === 'ICC_PROFILE\0') parts.push(b.subarray(start, end));
    } else if (marker === 0xee) {
      if (ascii(body, 0, 5) === 'Adobe') parts.push(b.subarray(start, end));
    } else if (marker < 0xe0 || marker > 0xfe) {
      parts.push(b.subarray(start, end)); // tables, frame headers, restart interval
    }
    // Everything else — APP1, APP3–APP13, APP15, the JPGn extensions and COM (0xFE) — is dropped.
  }
}

// Chunks a browser uses to draw a PNG or animated PNG. Text, eXIf, tIME, suggested palettes, histograms
// and private chunks are dropped.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'mDCv', 'cLLi', 'pHYs', 'bKGD', 'acTL', 'fcTL', 'fdAT']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whole chunks are copied or dropped, so every kept chunk keeps its own valid CRC. Bytes after IEND are dropped. */
function stripPng(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const n = b.length;
  if (n < 8 || PNG_SIGNATURE.some((v, k) => b[k] !== v)) return null;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8, image = false;
  for (;;) {
    if (i + 12 > n) return null;
    const length = be32(b, i);
    const type = ascii(b, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || length > 0x7fffffff || i + 12 + length > n) return null;
    if ((i === 8) !== (type === 'IHDR') || (type === 'IHDR' && length !== 13)) return null;
    const end = i + 12 + length;
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    // An unknown critical chunk (upper-case first letter) means no browser could draw the file anyway.
    else if (type.charCodeAt(0) < 0x61) return null;
    if (type === 'IDAT') image = true;
    i = end;
    if (type === 'IEND') return image ? concat(parts) : null;
  }
}

const WEBP_KEEP = new Set(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L']);
const WEBP_IMAGE = new Set(['VP8 ', 'VP8L', 'ANMF']);

/**
 * WebP drops EXIF, XMP and unknown chunks, clears VP8X's EXIF and XMP flags and rewrites the RIFF size.
 * A simple (non-VP8X) file is only its image chunk; anything after it, or after the RIFF size, is dropped.
 */
function stripWebp(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const n = b.length;
  if (n < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const riffEnd = 8 + le32(b, 4);
  if (riffEnd > n) return null;
  const parts: Uint8Array[] = [];
  let i = 12, extended = false, image = false;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) return null;
    const type = ascii(b, i, 4);
    const size = le32(b, i + 4);
    const end = i + 8 + size + (size & 1); // odd-sized chunks carry a padding byte
    if (end > riffEnd) return null;
    if (i === 12) {
      if (type === 'VP8X') { if (size !== 10) return null; extended = true; }
      else if (type === 'VP8 ' || type === 'VP8L') { parts.push(b.subarray(i, end)); image = true; break; }
      else return null;
    }
    if (WEBP_KEEP.has(type)) {
      if (type === 'VP8X') {
        if (i !== 12) return null;
        const chunk = b.slice(i, end);
        chunk[8] &= ~0x0c; // EXIF (0x08) and XMP (0x04) present
        parts.push(chunk);
      } else parts.push(b.subarray(i, end));
      if (WEBP_IMAGE.has(type)) image = true;
    }
    i = end;
  }
  if (!image || (extended && i !== riffEnd)) return null;
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  const size = parts.reduce((total, p) => total + p.length, 4);
  new DataView(header.buffer).setUint32(4, size, true);
  return concat([header, ...parts]);
}

// Application extensions that only say how many times an animation loops.
const GIF_LOOPING = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);

/**
 * GIF keeps its header, colour tables, images and graphic control (frame timing and transparency) and
 * looping extensions. Comments, plain-text blocks and other application extensions (where XMP and ICC
 * live) are dropped, as is anything after the trailer.
 */
function stripGif(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const n = b.length;
  const version = n >= 13 ? ascii(b, 0, 6) : '';
  if (version !== 'GIF87a' && version !== 'GIF89a') return null;
  const tableSize = (flags: number) => (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
  let i = 13 + tableSize(b[10]);
  if (i > n) return null;
  const parts: Uint8Array[] = [b.subarray(0, i)];
  // Data sub-blocks: a size byte and that many bytes, until a zero size. Returns where they end, or -1.
  const subBlocks = (j: number) => {
    while (j < n) {
      const size = b[j];
      j += 1 + size;
      if (size === 0) return j;
    }
    return -1;
  };
  let images = 0;
  while (i < n) {
    const block = b[i];
    if (block === 0x3b) {
      if (!images) return null;
      parts.push(b.subarray(i, i + 1));
      return concat(parts);
    }
    let end: number;
    if (block === 0x2c) {
      if (i + 11 > n) return null;
      // Descriptor (10 bytes), local colour table, LZW minimum code size, then the image data.
      const data = i + 10 + tableSize(b[i + 9]) + 1;
      if (data > n || b[data - 1] > 11) return null;
      end = subBlocks(data);
      if (end < 0) return null;
      parts.push(b.subarray(i, end));
      images++;
    } else if (block === 0x21) {
      if (i + 2 > n) return null;
      const label = b[i + 1];
      end = subBlocks(i + 2);
      if (end < 0) return null;
      const looping = label === 0xff && b[i + 2] === 11 && i + 14 <= end && GIF_LOOPING.has(ascii(b, i + 3, 11));
      if (label === 0xf9 || looping) parts.push(b.subarray(i, end));
    } else return null;
    i = end;
  }
  return null;
}

/** The file rebuilt without its metadata, or null when it isn't a well-formed file of that type. */
export function stripImageMetadata(bytes: Uint8Array, type: string): Uint8Array<ArrayBuffer> | null {
  switch (type) {
    case 'image/jpeg': return stripJpeg(bytes);
    case 'image/png': return stripPng(bytes);
    case 'image/webp': return stripWebp(bytes);
    case 'image/gif': return stripGif(bytes);
    default: return null;
  }
}

export type CheckedImage = { bytes: Uint8Array<ArrayBuffer>; type: string; ext: string; width: number; height: number };

export async function checkUpload(file: File, maxBytes = MAX_UPLOAD_BYTES, label = 'Image'): Promise<CheckedImage | string> {
  if (file.size > maxBytes) return `${label} must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  const original = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(original);
  if (!info) return `${label} must be a PNG, JPEG, GIF or WebP file.`;
  if (!info.width || !info.height || info.width > MAX_EDGE || info.height > MAX_EDGE) return `${label} is too large; keep it under ${MAX_EDGE} pixels on each side.`;
  const bytes = stripImageMetadata(original, info.type);
  // The rebuilt file must still read as the same image; anything else means the original was damaged.
  const after = bytes && imageInfo(bytes);
  if (!bytes || !after || after.type !== info.type || after.width !== info.width || after.height !== info.height) {
    return `${label} couldn’t be read; the file may be damaged. Save it again and retry.`;
  }
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
 * batch it with whatever uses the image. The file is written first, so a record never points at nothing;
 * run the batch through `batchWithUploads` so a failed batch doesn't leave the file behind.
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

/**
 * Deletes the files of new uploads whose records were never saved. A file goes only when nothing in the
 * database refers to it: no library row (a batch can commit and still report failure, and then the row
 * and its file must both stay), no story, ad or event, and no ad banner pointing at its key. If the check
 * itself fails, the file stays; an unreferenced file is harmless, a missing one is not.
 */
export async function discardUnsavedMedia(records: { id: string; object_key: string }[]): Promise<void> {
  for (const record of records) {
    try {
      const [rows, banners] = await env.DB.batch([
        env.DB.prepare('SELECT id FROM media WHERE id = ? OR object_key = ? LIMIT 1').bind(record.id, record.object_key),
        env.DB.prepare('SELECT ad_id FROM ad_images WHERE object_key = ? LIMIT 1').bind(record.object_key),
      ]);
      if (rows.results.length || banners.results.length) continue;
      const usage = await mediaUsage(record);
      if (usage.stories.length || usage.ads.length || usage.events.length) continue;
      await env.MEDIA.delete(record.object_key);
    } catch {
      console.warn(`Unsaved upload left in storage: ${record.object_key}`);
    }
  }
}

/** Runs a batch that saves new uploads, removing their files if it fails, then rethrows the failure. */
export async function batchWithUploads(uploads: { id: string; object_key: string }[], statements: D1PreparedStatement[]) {
  try {
    return await env.DB.batch(statements);
  } catch (error) {
    await discardUnsavedMedia(uploads);
    throw error;
  }
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
