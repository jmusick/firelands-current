// Browser side of the media library: shrinks photos before upload and talks to /api/admin/media.

export type MediaItem = {
  id: string; url: string; width: number; height: number; filename: string;
  alt: string; decorative: boolean; caption: string; credit: string;
};

const MAX_EDGE = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));

/**
 * Redraws the image at most MAX_EDGE pixels on its long side. Redrawing also drops the file's
 * metadata, including a phone photo's GPS location. PNGs stay PNG so logos keep transparency;
 * GIFs are left alone so animations survive.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, GIF or WebP image.');
  if (file.type === 'image/gif') return file;
  // createImageBitmap applies the photo's EXIF orientation, so the redrawn image stays upright.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  let blob = await encode(canvas, type);
  // A large photo saved as PNG can still be too big; JPEG it is.
  if (blob && blob.size > MAX_BYTES && type === 'image/png') blob = await encode(canvas, (type = 'image/jpeg'));
  if (!blob) throw new Error('This browser couldn’t process the image.');
  const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
  return new File([blob], name, { type });
}

export async function uploadImage(file: File, details: { alt: string; decorative: boolean; caption: string; credit: string; source: string }): Promise<MediaItem> {
  const body = new FormData();
  body.set('action', 'upload');
  body.set('file', await prepareImage(file));
  const { decorative, ...text } = details;
  for (const [key, value] of Object.entries(text)) body.set(key, value);
  if (decorative) body.set('decorative', 'on');
  const response = await fetch('/api/admin/media', { method: 'POST', body, headers: { Accept: 'application/json' } });
  const data = (await response.json().catch(() => ({}))) as { item?: MediaItem; error?: string };
  if (!response.ok || !data.item) throw new Error(data.error || 'The upload failed. Try again.');
  return data.item;
}

export async function listLibrary(q: string, page: number): Promise<{ items: MediaItem[]; more: boolean }> {
  const response = await fetch(`/api/admin/media?${new URLSearchParams({ q, page: String(page) })}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Couldn’t load the media library.');
  return response.json();
}

/** Markdown for an image in a story. Brackets and line breaks would end the alt text early. */
export const imageMarkdown = (item: MediaItem) => `![${(item.alt || '').replace(/[[\]\n]/g, ' ').trim()}](${item.url})`;
