# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: local residents, broadly.** Anyone in Sandusky and the Firelands who wants to know what is happening nearby: the news, what is on this week, and what their neighbors think about it. No narrower core group is privileged; a civic regular, a family looking for something to do on Saturday, and someone who came from a Facebook share all need to be served by the same pages. Many arrive on phones, from social posts, search, or the RSS/JSON feeds.

Secondary audiences, all confirmed by existing features:

- **Talk of the Town participants:** signed-in readers who comment on stories and events, vote, start their own discussions, and report posts.
- **Contributors from the community:** people who send news tips (`/submit-news`), submit events (`/submit-event`), or report an inaccuracy. Most never create an account.
- **Local businesses:** advertisers who inquire on `/advertise` and, once booked, use the business portal at `/business` to see their ads and stats.
- **Staff:** the people working in `/admin` as admin, editor, or moderator (see Operating Context).

## Product Purpose

Firelands Current is an independent local newspaper for Sandusky, Ohio and the communities around Sandusky Bay, live at https://firelandscurrent.com. It publishes news, a local events calendar, practical guides, and hosts reader discussion in Talk of the Town. It is owned and operated by Stone Dragon Media, LLC, and is funded by display ads sold to local businesses.

Success means local residents treat it as the place to find out what is happening, check the facts for themselves, and talk about it, and local businesses find it worth advertising on.

## Positioning

Three things together, which neighboring outlets (the paywalled daily, regional TV, Facebook community groups) do not offer in one place:

1. **Free, no paywall.** Every story, event, and guide is readable by anyone.
2. **Primary-sourced and linked.** Facts come from the city, school district, county office, agency, or the document itself, written in the paper's own words, with a link so readers can check. Dates are verified on the source page; gaps in an announcement are stated, not filled.
3. **Discussion built in.** Every published story and event has a Talk of the Town thread, and the comments under a story are the same ones on its discussion page. Readers can start their own discussions too.

## Operating Context

- **Newsroom:** solo today, growing. One person (JD) does the reporting, editing, ad management, and moderation now, with plans to add editors, moderators, or contributors. Staff roles (`admin`, `editor`, `moderator`) and audited admin actions already exist for that growth; admin tooling should work for one person doing everything and for a future team splitting it.
- **Coverage area:** core is Sandusky, Perkins Township, Huron, Vermilion, Milan, Castalia, Berlin Heights, Bay View, Kelleys Island and the rest of Erie County; regular coverage of Ottawa, Sandusky, Huron, and western Lorain counties; edge coverage of eastern Lorain and northern Seneca counties only when a story lands here. Details in `docs/news-sources.md`.
- **Story workflow:** stories are written in Markdown in the admin News editor (EasyMDE), drafted and reviewed locally, then synced to production when ready. Editorial rules live in `docs/news-sources.md`; dated reporting records live in a separate project library, not this repo.
- **Distribution:** homepage and section pages, RSS and JSON Feed, Google News sitemap, share links (plain links, no third-party scripts), and a Facebook Page posting queue.
- **Reader inputs:** news tips, event submissions, and inaccuracy reports go into review queues in `/admin`; contact and advertising inquiries go to email.

## Capabilities and Constraints

- **Sections and features:** News (sections, story pages, related coverage), Events (list and month calendar, add-to-calendar, event data), Guides (`/guides/recycling`, `/guides/food-assistance`, `/guides/free-and-low-cost-activities`), Talk of the Town (nested comments, votes, Top/Newest/Oldest), site search, public profiles with author bios for staff, accounts with email/password and optional Google, Facebook, Apple, and Microsoft sign-in.
- **Ads:** display ads in defined placements (`PLACEMENTS` in `src/lib/ads.ts`), labeled "Advertisement," or "Sponsored" with the advertiser's name among stories or discussions; unbooked space may carry a house notice labeled "From Firelands Current." Ads never appear on forms, account pages, business dashboards, or the admin panel. Ads are managed apart from story editing and only administrators can open that area.
- **Images:** every image comes from the media library with a required credit and an alt-text decision; the paper runs only images it made or has permission to use.
- **Dates:** public dates and times are Eastern time in AP style ("Oct. 25, 2026, at 9:48 a.m.").
- **Technical:** Astro server output on Cloudflare Workers, D1 and R2, plain CSS with no framework, Lucide icons in the admin panel, a nonce-based Content Security Policy (no inline handlers, `<style>` elements, or new third-party origins without updating the policy and Privacy Policy). Editor assets are bundled, never from a CDN. See `AGENTS.md`.
- **Privacy:** the Privacy Policy (`/privacy`) must stay accurate for anything collected, shown publicly, or sent to a third party. Search words are never logged or sent to analytics.

## Brand Commitments

- **Name:** Firelands Current. Default description: "Independent local news and conversation for Sandusky and the Firelands." Footer line: "Independent local reporting and conversation for Sandusky and the Firelands."
- **Assets:** `public/logo.svg`, `public/logo-mark.svg`, `public/social-logo.png`.
- **Social:** Facebook (Firelands Current) and X (@FirelandCurrent), linked from the footer.
- **Voice:** plain, factual, and specific. Claims are attributed to whoever made them; what is unknown is said out loud. Public pages name no individuals beyond bylines. No "Firelands Current staff" byline.
- **Trust signals that must stay visible:** source links in stories, bylines that link to profiles, the "Report an inaccuracy" link on every story and event, and clear ad labels.

## Evidence on Hand

- Real published stories, events, and discussions in the production database (the local D1 copy matches production content).
- Three published guides under `src/pages/guides/`.
- The About page (`/about`) and editorial standards in `docs/news-sources.md`; accessibility rules in `docs/accessible-publishing.md`.
- **Absent, do not fabricate:** readership or traffic numbers, reader testimonials, advertiser case studies, awards, or press. `scripts/seed-demo.sql`, `scripts/seed-ads-demo.sql`, and `scripts/seed-talk-starter.sql` contain fictional content and are not evidence of real readers or advertisers.

## Product Principles

1. **Let readers check it.** Every fact a reader might doubt should be one click from its source; design never buries a source link, byline, date, or correction route.
2. **Free and open first.** Reading never requires an account; signing in is for taking part (posting, voting), not for access.
3. **News and ads stay visibly separate.** Ads are labeled, kept out of forms, accounts, dashboards, and admin, and never styled to pass as reporting.
4. **The conversation belongs to the story.** Discussion is part of each story and event, not a separate destination readers must find.
5. **Built for one, ready for a team.** Admin tools should let a solo editor work quickly today without shortcuts that break once roles are split among several people.

## Accessibility & Inclusion

The stated goal is WCAG 2.2 level AA for the public site, explicitly a goal and not a conformance claim (`/accessibility`, last reviewed Oct. 11, 2026). Every page has a skip link and main landmark; images need alt-text decisions; `npm run test:a11y` checks axe-core rules, forced colors, reduced motion, and Tab order. Known limits (Turnstile, the EasyMDE editor, ad artwork, older content, third-party sign-in) are listed on that page, which must stay accurate when they change. Readers include people using screen readers, keyboards, magnification, and other assistive technology.
