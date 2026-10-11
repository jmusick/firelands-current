import { listLibrary, type MediaItem } from './media-client';

// Drives the <MediaPicker /> dialog. openMediaPicker() resolves with the chosen or newly uploaded
// image, or null if the dialog is closed without one.

let resolveCurrent: ((item: MediaItem | null) => void) | null = null;
let wired: HTMLDialogElement | null = null;
let query = '';
let page = 0;

function finish(dialog: HTMLDialogElement, item: MediaItem | null) {
  const resolve = resolveCurrent;
  resolveCurrent = null;
  if (dialog.open) dialog.close();
  resolve?.(item);
}

function showTab(dialog: HTMLDialogElement, name: 'library' | 'upload') {
  dialog.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1; // roving tabindex: only the selected tab is in the Tab order
  });
  dialog.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
}

async function load(dialog: HTMLDialogElement, reset: boolean) {
  const grid = dialog.querySelector<HTMLElement>('.grid')!;
  const more = dialog.querySelector<HTMLButtonElement>('.more')!;
  const empty = dialog.querySelector<HTMLElement>('.empty')!;
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const failed = dialog.querySelector<HTMLElement>('.load-error')!;
  if (reset) { page = 0; grid.replaceChildren(); }
  failed.hidden = true;
  const asked = query;
  status.textContent = 'Loading images…';
  let result;
  try {
    result = await listLibrary(query, page);
  } catch {
    if (asked !== query) return;
    // The visible error also reaches screen readers through the status region.
    status.textContent = "Couldn't load images.";
    failed.hidden = false;
    more.hidden = true;
    empty.hidden = true;
    return;
  }
  if (asked !== query) return;
  const { items, more: hasMore } = result;
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    img.loading = 'lazy';
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: item.filename });
    const dims = Object.assign(document.createElement('span'), { className: 'dims', textContent: `${item.width}×${item.height} · ${item.credit}` });
    // An image with no alt text and no decorative decision goes into the story with an empty alternative.
    const undecided = !item.alt && !item.decorative
      ? [Object.assign(document.createElement('span'), { className: 'dims needs-alt', textContent: 'Needs alt text — set it in the media library' })]
      : [];
    button.replaceChildren(img, name, dims, ...undecided);
    button.title = item.caption || item.alt || item.filename;
    button.addEventListener('click', () => finish(dialog, item));
    grid.appendChild(button);
  }
  empty.hidden = grid.childElementCount > 0 || query !== '';
  more.hidden = !hasMore;
  const total = grid.childElementCount;
  status.textContent = total === 0
    ? (query ? `No images match '${query}'` : 'No images yet')
    : `${total} ${total === 1 ? 'image' : 'images'}${hasMore ? ' so far' : ''}`;
}

function wire(dialog: HTMLDialogElement) {
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  tabs.forEach((tab) => tab.addEventListener('click', () => showTab(dialog, tab.dataset.tab as 'library' | 'upload')));
  // Arrow keys, Home and End move focus and select (automatic activation: switching panels is instant).
  dialog.querySelector('[role=tablist]')!.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next = key === 'ArrowRight' ? (at + 1) % tabs.length
      : key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : key === 'Home' ? 0
      : key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    showTab(dialog, tabs[next].dataset.tab as 'library' | 'upload');
    tabs[next].focus();
  });
  dialog.querySelector('[data-close]')!.addEventListener('click', () => finish(dialog, null));
  dialog.addEventListener('close', () => finish(dialog, null));
  let timer: ReturnType<typeof setTimeout>;
  const search = dialog.querySelector<HTMLInputElement>('.search')!;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = search.value.trim(); load(dialog, true); }, 250);
  });
  // Retry the request that failed: the first page resets the grid, a later page appends.
  dialog.querySelector('.retry')!.addEventListener('click', () => load(dialog, page === 0));
  dialog.querySelector('.more')!.addEventListener('click', () => { page++; load(dialog, false); });
  dialog.addEventListener('media-uploaded', (event) => finish(dialog, (event as CustomEvent<MediaItem>).detail));
}

export function openMediaPicker(options: { title?: string; file?: File } = {}): Promise<MediaItem | null> {
  const dialog = document.getElementById('media-picker') as HTMLDialogElement | null;
  if (!dialog) return Promise.resolve(null);
  if (wired !== dialog) { wire(dialog); wired = dialog; }
  if (resolveCurrent) finish(dialog, null);
  dialog.querySelector('h2')!.textContent = options.title ?? 'Choose an image';
  const search = dialog.querySelector<HTMLInputElement>('.search')!;
  search.value = query = '';
  if (options.file) {
    // A dropped or pasted file goes straight to the upload form, which still needs its credit.
    const input = dialog.querySelector<HTMLInputElement>('form[data-media-upload] input[type=file]')!;
    const files = new DataTransfer();
    files.items.add(options.file);
    input.files = files.files;
    input.dispatchEvent(new Event('change'));
    showTab(dialog, 'upload');
  } else showTab(dialog, 'library');
  load(dialog, true);
  dialog.showModal();
  return new Promise((resolve) => { resolveCurrent = resolve; });
}
