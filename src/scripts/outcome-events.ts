// Reports newspaper outcomes (sign_up, news_tip_submitted, advertiser_inquiry) to Google Analytics, only after
// the action succeeded and only on pages where gtag already loads (BaseLayout leaves it off sign-in,
// registration, and account pages). Nothing a visitor typed is sent: just the event name and, for sign_up,
// the sign-in method or, for forms, the form name.
//
// Registration and social sign-up finish on pages without gtag, so they leave a pending record in
// localStorage and the next page that has gtag sends it. The record is removed before the event is sent,
// so a reload or a second tab cannot count it twice.

const PENDING_KEY = 'fc-pending-outcomes';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SIGN_UP_METHODS = new Set(['email', 'google', 'facebook', 'apple', 'microsoft']);
const INBOX_EVENTS: Record<string, { name: string; form: string }> = {
  '/submit-news': { name: 'news_tip_submitted', form: 'news' },
  '/advertise': { name: 'advertiser_inquiry', form: 'ads' },
};

type Pending = { method: string; at: number };
type Gtag = (...args: unknown[]) => void;

function readPending(): Pending[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writePending(items: Pending[]) {
  try {
    if (items.length) localStorage.setItem(PENDING_KEY, JSON.stringify(items));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* Storage can be blocked; the outcome is simply not counted. */ }
}

export function queueSignUp(method: string) {
  if (!SIGN_UP_METHODS.has(method)) return;
  writePending([...readPending(), { method, at: Date.now() }]);
}

function dropParam(name: string) {
  const url = new URL(location.href);
  url.searchParams.delete(name);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

function run() {
  const params = new URLSearchParams(location.search);

  // A social sign-up lands on /account?signup=<provider>, where gtag is off: queue it and clean the address.
  if (location.pathname === '/account' && params.has('signup')) {
    queueSignUp(params.get('signup') ?? '');
    dropParam('signup');
  }

  // Nothing below can send without gtag, so account pages stop here with their records still pending.
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag !== 'function') return;

  const pending = readPending();
  if (pending.length) {
    writePending([]);
    pending.filter((item) => Date.now() - item.at < MAX_AGE_MS && SIGN_UP_METHODS.has(item.method))
      .forEach((item) => gtag('event', 'sign_up', { method: item.method }));
  }

  // The inbox endpoint redirects with o=1 only for an accepted submission; remove it so a reload does not recount.
  const inbox = INBOX_EVENTS[location.pathname];
  if (inbox && params.get('o') === '1') {
    dropParam('o');
    gtag('event', inbox.name, { form: inbox.form });
  }
}

run();
