// UTM convention for links we publish ourselves (Facebook Page posts, future newsletters).
// Lowercase snake_case values so GA groups them consistently:
//   utm_source   the platform that carries the link   (facebook, newsletter)
//   utm_medium   the channel type                     (social, email)
//   utm_campaign what the link is for                 (story_share, ...)
// Never use this for internal navigation or reader share buttons, and never store the result
// as a canonical URL: tagged links are for sending, canonical URLs stay clean.
export type Campaign = { source: string; medium: string; campaign: string };

export const FACEBOOK_STORY_SHARE: Campaign = { source: 'facebook', medium: 'social', campaign: 'story_share' };

export function campaignUrl(url: string, { source, medium, campaign }: Campaign): string {
  const tagged = new URL(url);
  tagged.searchParams.set('utm_source', source);
  tagged.searchParams.set('utm_medium', medium);
  tagged.searchParams.set('utm_campaign', campaign);
  return tagged.href;
}
