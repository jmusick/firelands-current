// Better Auth's captcha plugin reads the Turnstile token from this header.
export function captchaHeaders(form: HTMLFormElement): Record<string, string> {
  const token = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value ?? '';
  return { 'x-captcha-response': token };
}

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

const widgets = new Map<HTMLElement, string>();

// Each token works once, so a failed attempt needs a fresh challenge.
export function resetCaptcha(): void {
  const api = window.turnstile;
  if (!api) return;
  for (const id of widgets.values()) api.reset(id);
}

const MESSAGES = {
  expired: 'The human check expired. Complete it again before sending.',
  timeout: 'The human check timed out. Complete it again before sending.',
  error: 'The human check could not run. Check your connection and try again, or reload the page.',
  load: 'The human check could not load. Check your connection or any content blocker, then reload the page.',
} as const;

let apiPromise: Promise<TurnstileApi> | undefined;
// Loaded here, with explicit rendering, so the widget callbacks below are in place before any challenge runs.
function loadApi(): Promise<TurnstileApi> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('missing')));
    script.onerror = () => reject(new Error('load'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

// The status element is always in the page, so changing its text is announced politely.
async function mount(box: HTMLElement): Promise<void> {
  const widget = box.querySelector<HTMLElement>('[data-captcha-widget]')!;
  const status = box.querySelector<HTMLElement>('[data-captcha-status]')!;
  const say = (text: string) => { status.textContent = text; };
  let api: TurnstileApi;
  try { api = await loadApi(); } catch { say(MESSAGES.load); return; }
  const id = api.render(widget, {
    sitekey: box.dataset.sitekey,
    // The normal widget is a fixed 300px wide, which overflows a 320px screen (or 400% zoom) once page and card padding are counted.
    size: window.matchMedia('(max-width: 400px)').matches ? 'compact' : 'normal',
    action: box.dataset.action || undefined,
    callback: () => say(''),
    'expired-callback': () => say(MESSAGES.expired),
    'timeout-callback': () => say(MESSAGES.timeout),
    // Returning true tells Turnstile the failure is handled; it still retries on its own.
    'error-callback': () => { say(MESSAGES.error); return true; },
    'before-interactive-callback': () => say(''),
  });
  widgets.set(widget, id);
}

document.querySelectorAll<HTMLElement>('[data-captcha]').forEach((box) => { void mount(box); });
