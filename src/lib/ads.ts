import { env } from 'cloudflare:workers';
import { signEvent, statDay } from './ad-tracking';
import { mediaUrl } from './media';
import { SECTIONS, type Section } from './news';

// Ad inventory. Each placement is a spot the paper sells; pages ask for ads by placement
// and the planner decides what fills it from the ads staff have booked in the admin panel.

export type AdFormat = 'leaderboard' | 'rectangle' | 'billboard' | 'native';

export type Placement = {
  label: string;
  format: AdFormat;
  /** Where it appears, for the admin panel and the advertise page. */
  where: string;
};

export const PLACEMENTS = {
  'site-leaderboard': { label: 'Site leaderboard', format: 'leaderboard', where: 'Top of every news and discussion page, below the navigation.' },
  'home-rail': { label: 'Front page rectangle', format: 'rectangle', where: 'Beside the top stories on the front page.' },
  'home-billboard': { label: 'Front page billboard', format: 'billboard', where: 'Full width, between the top stories and the rest of the front page.' },
  'article-inline': { label: 'In-story', format: 'rectangle', where: 'Within the text of longer stories, after the opening paragraphs.' },
  'article-rail': { label: 'Story sidebar', format: 'rectangle', where: 'Beside the story on wide screens; stays in view while reading.' },
  'news-feed': { label: 'News feed sponsored listing', format: 'native', where: 'Between stories in the news listings, styled like a headline.' },
  'talk-feed': { label: 'Talk of the Town sponsored listing', format: 'native', where: 'Between discussions in Talk of the Town.' },
} as const satisfies Record<string, Placement>;

export type PlacementKey = keyof typeof PLACEMENTS;
export const isPlacement = (value: string): value is PlacementKey => Object.hasOwn(PLACEMENTS, value);

export const FORMAT_SIZES: Record<AdFormat, string> = {
  leaderboard: '728×90 (320×100 on phones)',
  rectangle: '300×250',
  billboard: '970×250 (300×250 on phones)',
  native: 'Headline, short text and link',
};

/** Uploadable banner sizes. Images may be exactly this size or twice it, for sharp high-density screens. */
export const IMAGE_SIZES = {
  leaderboard: { label: 'Leaderboard', width: 728, height: 90 },
  mobile: { label: 'Phone leaderboard', width: 320, height: 100 },
  rectangle: { label: 'Rectangle', width: 300, height: 250 },
  billboard: { label: 'Billboard', width: 970, height: 250 },
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;
export const isImageSize = (value: string): value is ImageSize => Object.hasOwn(IMAGE_SIZES, value);

/** Which image each format shows on wide screens and on phones. A missing image falls back to the text creative. */
export const FORMAT_IMAGES: Record<Exclude<AdFormat, 'native'>, { desktop: ImageSize; mobile: ImageSize }> = {
  leaderboard: { desktop: 'leaderboard', mobile: 'mobile' },
  rectangle: { desktop: 'rectangle', mobile: 'rectangle' },
  billboard: { desktop: 'billboard', mobile: 'rectangle' },
};

export type AdImage = { url: string; width: number; height: number };

export type Ad = {
  id: string;
  /** The advertiser's business; at most one ad per business shows on a page. */
  businessId: string | null;
  advertiser: string;
  headline: string;
  body: string;
  cta: string;
  href: string;
  /** Background, text and accent colors for the text creative. */
  theme: { bg: string; fg: string; accent: string };
  /** Placements this ad has booked; empty means run of site. */
  placements: PlacementKey[];
  /** News sections this ad is aimed at; empty means any. Targeted ads win on matching pages. */
  sections: Section[];
  /** Relative share of rotation among eligible ads, 1–10. */
  weight: number;
  images: Partial<Record<ImageSize, AdImage>>;
  kind: 'booked' | 'sample' | 'house';
};

export const DEFAULT_THEME: Ad['theme'] = { bg: '#173d4a', fg: '#edf2ed', accent: '#e7a98d' };

// Shown only while nothing has been booked at all, so the site's ad spaces can be seen before any are sold.
const SAMPLE_ADS: Ad[] = [
  {
    id: 'sample-hardware', businessId: null, advertiser: 'Cedar Street Hardware', kind: 'sample', images: {},
    headline: 'Get your dock ready for summer', body: 'Marine hardware, paint and friendly advice since 1962.', cta: 'Shop the dock aisle',
    href: '/advertise', theme: { bg: '#2f4a3a', fg: '#f4efe2', accent: '#e6b35a' }, placements: [], sections: ['outdoors', 'community'], weight: 3,
  },
  {
    id: 'sample-dental', businessId: null, advertiser: 'Lakeshore Family Dental', kind: 'sample', images: {},
    headline: 'New patients welcome', body: 'Evening and Saturday appointments for the whole family.', cta: 'Book a visit',
    href: '/advertise', theme: { bg: '#e8f1f2', fg: '#173d4a', accent: '#2c8a9a' }, placements: [], sections: [], weight: 2,
  },
  {
    id: 'sample-bakery', businessId: null, advertiser: 'Old Firehouse Bakery', kind: 'sample', images: {},
    headline: 'Fresh pierogi every Friday', body: 'Plus pies, kolaches and coffee in the old station on Main.', cta: 'See this week’s menu',
    href: '/advertise', theme: { bg: '#8a3b22', fg: '#fff6ec', accent: '#f2c48d' }, placements: [], sections: ['community', 'local'], weight: 2,
  },
  {
    id: 'sample-credit', businessId: null, advertiser: 'Firelands Community Credit', kind: 'sample', images: {},
    headline: 'Small business loans, decided locally', body: 'Talk to a lender who knows the neighborhood.', cta: 'Start the conversation',
    href: '/advertise', theme: DEFAULT_THEME, placements: [], sections: ['business', 'government'], weight: 2,
  },
  {
    id: 'sample-tutoring', businessId: null, advertiser: 'Bright Harbor Tutoring', kind: 'sample', images: {},
    headline: 'Back-to-school help that sticks', body: 'Math and reading tutors for grades K–12.', cta: 'Meet our tutors',
    href: '/advertise', theme: { bg: '#fbeee2', fg: '#5a2a18', accent: '#bc633e' }, placements: [], sections: ['schools'], weight: 2,
  },
];

/** Shown when nothing booked fits a slot, so unsold space sells itself. */
const HOUSE_AD: Ad = {
  id: 'house-advertise', businessId: null, advertiser: 'Firelands Current', kind: 'house', images: {},
  headline: 'Reach your neighbors here', body: 'Put your business in front of readers across Sandusky and the Firelands.', cta: 'Advertise with us',
  href: '/advertise', theme: { bg: '#dceaec', fg: '#173d4a', accent: '#1c6880' }, placements: [], sections: [], weight: 1,
};

export type AdRow = {
  id: string; business_id: string; advertiser: string; headline: string; body: string; cta: string; href: string;
  theme_bg: string; theme_fg: string; theme_accent: string; placements: string; sections: string; weight: number;
};
export type AdImageRow = { ad_id: string; size: ImageSize; object_key: string; width: number; height: number };

const parseList = <T extends string>(json: string, valid: (v: string) => v is T): T[] => {
  try { const list = JSON.parse(json); return Array.isArray(list) ? list.filter((v): v is T => typeof v === 'string' && valid(v)) : []; } catch { return []; }
};
const isSectionKey = (v: string): v is Section => Object.hasOwn(SECTIONS, v);

export { mediaUrl };

export function adFromRow(row: AdRow, images: AdImageRow[]): Ad {
  return {
    id: row.id, businessId: row.business_id, advertiser: row.advertiser, kind: 'booked',
    headline: row.headline, body: row.body, cta: row.cta, href: row.href,
    theme: { bg: row.theme_bg, fg: row.theme_fg, accent: row.theme_accent },
    placements: parseList(row.placements, isPlacement), sections: parseList(row.sections, isSectionKey), weight: row.weight,
    images: Object.fromEntries(images.filter((i) => i.ad_id === row.id).map((i) => [i.size, { url: mediaUrl(i.object_key), width: i.width, height: i.height }])),
  };
}

/** Ads that may run right now: active, within their dates, under their impression cap, for an active business. */
async function inventory(): Promise<Ad[]> {
  const live = `
    FROM ads a JOIN businesses b ON b.id = a.business_id
    WHERE a.status = 'active' AND b.status = 'active'
      AND (a.starts_on IS NULL OR a.starts_on <= ?1) AND (a.ends_on IS NULL OR a.ends_on >= ?1)
      AND (a.impression_cap IS NULL OR a.impressions < a.impression_cap)`;
  const today = statDay();
  const [ads, images, booked] = await env.DB.batch([
    env.DB.prepare(`SELECT a.id, a.business_id, b.name AS advertiser, a.headline, a.body, a.cta, a.href, a.theme_bg, a.theme_fg, a.theme_accent, a.placements, a.sections, a.weight ${live}`).bind(today),
    env.DB.prepare(`SELECT i.ad_id, i.size, i.object_key, i.width, i.height FROM ad_images i WHERE i.ad_id IN (SELECT a.id ${live})`).bind(today),
    env.DB.prepare('SELECT EXISTS (SELECT 1 FROM ads) AS any'),
  ]);
  const rows = ads.results as AdRow[];
  if (!rows.length && !(booked.results[0] as { any: number }).any) return SAMPLE_ADS;
  return rows.map((row) => adFromRow(row, images.results as AdImageRow[]));
}

export type AdContext = { section?: Section };
export type ServedAd = { ad: Ad; href: string; token: string | null };

/**
 * Picks ads for one page view. Every slot on the page draws from the same plan, so an
 * advertiser appears at most once per page and targeted ads fill slots before run-of-site ones.
 */
export class AdPlan {
  private used = new Set<string>();
  constructor(private ads: Ad[], public context: AdContext, private track: boolean) {}

  async take(placement: PlacementKey): Promise<ServedAd> {
    const bookable = this.ads.filter((ad) => (!ad.placements.length || ad.placements.includes(placement)) && !this.used.has(ad.businessId ?? ad.advertiser));
    const section = this.context.section;
    const targeted = section ? bookable.filter((ad) => ad.sections.includes(section)) : [];
    const pool = targeted.length ? targeted : bookable.filter((ad) => !ad.sections.length || !section);
    const ad = weightedPick(pool.length ? pool : bookable) ?? HOUSE_AD;
    if (ad !== HOUSE_AD) this.used.add(ad.businessId ?? ad.advertiser);
    if (ad.kind !== 'booked' || !this.track) return { ad, href: ad.href, token: null };
    const token = await signEvent(ad.id, placement);
    return { ad, href: `/ads/click?t=${encodeURIComponent(token)}`, token };
  }
}

function weightedPick(ads: Ad[]): Ad | undefined {
  const total = ads.reduce((sum, ad) => sum + ad.weight, 0);
  let roll = Math.random() * total;
  return ads.find((ad) => (roll -= ad.weight) < 0);
}

// One plan per request, shared by the layout and the page without threading it through props.
// A page's frontmatter runs before its layout renders, so a page that passes a context sets it.
const plans = new WeakMap<Request, Promise<AdPlan>>();

/** Staff browsing the site don't count toward advertisers' numbers. */
export function adPlanFor(request: Request, locals: App.Locals, context: AdContext = {}): Promise<AdPlan> {
  let plan = plans.get(request);
  if (!plan) {
    plan = inventory().then((ads) => new AdPlan(ads, context, !locals.staffRole));
    plans.set(request, plan);
  }
  return plan;
}

/** Pages that are about the reader's own business — forms, accounts, dashboards — carry no ads. */
export function pageTakesAds(pathname: string): boolean {
  return !/^\/(admin|account|business|sign-in|register|forgot-password|reset-password|reauth|talk\/new|advertise|report-inaccuracy|api)(\/|$)/.test(pathname);
}

/** Where in-story ads go: after the third block, and again after the tenth in long stories. Short stories get none. */
export function inlineAdBreaks(blockCount: number): number[] {
  if (blockCount < 6) return [];
  return blockCount >= 14 ? [3, 10] : [3];
}

/** Indexes after which a feed of `count` items gets a sponsored listing: after the 4th, then every 8th. */
export function feedAdBreaks(count: number): number[] {
  const breaks: number[] = [];
  for (let i = 4; i < count; i += 8) breaks.push(i);
  return breaks;
}
