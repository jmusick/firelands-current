---
name: Firelands Current
description: Independent local news and conversation for Sandusky and the Firelands.
colors:
  deep: "#173d4a"
  deep-2: "#21525f"
  channel: "#1c6880"
  shoal: "#dceaec"
  shoal-2: "#eaf2f3"
  fog: "#f4f7f7"
  paper: "#ffffff"
  ink: "#1b2a2f"
  ink-soft: "#33474c"
  slate: "#56696e"
  line: "#c5d3d5"
  line-soft: "#dde6e7"
  field: "#667f84"
  sunset: "#e9a53a"
  logo-clay: "#bc633e"
  alert: "#8a3a1d"
  alert-bg: "#fdf1e8"
  alert-line: "#e6c2b0"
  warn: "#9a5212"
  warn-2: "#7c410e"
  ok: "#1f5a41"
  ok-bg: "#e6f2ea"
  ok-line: "#8fbfa2"
typography:
  masthead:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(2rem, 6.4vw, 4.4rem)"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 68"
  display:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(2.6rem, 6.2vw, 4.75rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 66"
  headline:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(2.4rem, 5.6vw, 3.9rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 66"
  title:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
  title-sm:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 72"
  lede:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(1.15rem, 2.2vw, 1.3rem)"
    fontWeight: 400
    lineHeight: 1.5
  body-read:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.22rem"
    fontWeight: 400
    lineHeight: 1.65
  body-scan:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 650
    lineHeight: 1.3
    fontVariation: "'wdth' 92"
  meta:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.4
    fontVariation: "'wdth' 95"
  date-numeral:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "3rem"
    fontWeight: 800
    lineHeight: 0.95
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 62"
rounded:
  none: "0"
  sm: "2px"
  md: "4px"
  pill: "999px"
spacing:
  gutter: "1.25rem"
  card: "1.4rem"
  section: "3rem"
  page-top: "2.25rem"
  page-bottom: "5rem"
components:
  button-primary:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1.15rem"
  button-primary-hover:
    backgroundColor: "{colors.deep-2}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.deep}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1.15rem"
  button-secondary-hover:
    backgroundColor: "{colors.shoal}"
    textColor: "{colors.deep}"
  button-small:
    padding: "0.45rem 0.8rem"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "{spacing.card}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 0.85rem"
  masthead:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.fog}"
    typography: "{typography.masthead}"
  nav-link:
    textColor: "#d4e4e7"
    padding: "0.8rem 0 0.65rem"
  filter-tab:
    textColor: "{colors.slate}"
    padding: "0.55rem 0 0.5rem"
  filter-tab-active:
    textColor: "{colors.deep}"
  status-pill:
    backgroundColor: "{colors.shoal-2}"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.55rem"
  footer:
    backgroundColor: "{colors.shoal}"
    textColor: "#3d5357"
---

# Design System: Firelands Current

## Overview

**Creative North Star: "The Lake Erie Ledger"**

Firelands Current looks like a town's paper of record that happens to live on the screen: calm, factual, and easy to check. The palette is drawn from the bay itself, deep water for the masthead and headlines, a harbor blue for anything a reader can follow, pale aqua for the few tinted bands, and one warm amber that only ever marks what is current. Nothing on the page competes with the news; the system's job is to make headlines quick to scan and stories pleasant to read through.

Two typefaces split that job. Archivo, narrowed hard through its width axis, carries everything a reader scans: the masthead, headlines, navigation, kickers, dates, and metadata. Newsreader, a text serif, carries everything a reader reads: story bodies, ledes, and the short descriptive paragraphs. The layout is a printed paper's: a dateline masthead, ruled columns, heavy rules over sections and light hairlines between items, flat surfaces, nearly square corners. Structure comes from rules and type, not from boxes, shadows, or color fills.

The newsroom's admin tools use the same palette and type set tighter, as a place for scanning and acting rather than reading.

**Key Characteristics:**
- Deep-water masthead with the day's dateline, as a printed paper carries
- Condensed Archivo for scanning, Newsreader serif for reading
- Flat surfaces: no shadows, depth by tinted bands and rules
- Heavy 3px rules head sections; 1px hairlines separate items
- 2px corners on everything interactive
- One warm accent, reserved for "now": today, the current page, a linked comment
- Light theme only

## Colors

A cool, low-saturation water palette with a single warm signal.

### Primary
- **Deep Teal-Navy** (`deep`): the masthead and admin header background, every heading, primary buttons, the 3px section rules, focus outlines, and the date numerals in the events list. It is the paper's ink for structure.
- **Lifted Teal-Navy** (`deep-2`): hover state for primary buttons and the hairline under the masthead.

### Secondary
- **Harbor Blue** (`channel`): links, kickers (the place or kind of a story), active upvotes, blockquote rules, and the focus outline on form fields. If a reader can follow it, it is Harbor Blue.

### Tertiary
- **Warm Amber** (`sunset`): the underline on the current navigation item, the rule over today's date in event lists, the left bar on a linked comment, and the "Admin" label and current-section icon in the newsroom tools. Never text on a light background.
- **Clay Orange** (`logo-clay`): appears only inside the logo files (`public/logo.svg`, `public/logo-mark.svg`). Not used in CSS.

### Neutral
- **Cool Off-White** (`fog`): the page background on every public and admin page, and the masthead brand text.
- **White** (`paper`): cards, form fields, admin secondary buttons.
- **Pale Aqua Mist** (`shoal`): the footer, the homepage "Coming up" band, secondary-button hover, image placeholders.
- **Faint Aqua Wash** (`shoal-2`): the ad band under the masthead, native ad blocks, the admin sidebar, status pills, highlighted rows.
- **Blue-Black Ink** (`ink`): body text.
- **Soft Ink** (`ink-soft`): ledes, captions, blockquotes; a step lighter than body text. It is repeated as a raw hex in the pages today, not yet a custom property in `tokens.css`.
- **Muted Blue-Gray** (`slate`): metadata, bylines, dates, inactive filter tabs, ad labels.
- **Gray-Aqua Rule** (`line`): filter-tab baselines, secondary-button borders, the homepage rail divider.
- **Soft Rule** (`line-soft`): hairlines between list items, card borders, fieldset borders.
- **Field Stroke Gray** (`field`): form-field borders, with enough contrast to find the field (3:1 against white).

### Status
- **Rust Red** (`alert`, on `alert-bg`, bordered by `alert-line`): errors, error summaries, invalid fields, destructive actions.
- **Burnt Orange** (`warn`, `warn-2`): reversible cautions in the admin tools.
- **Pine Green** (`ok`, on `ok-bg`, bordered by `ok-line`): success messages and published states.

### Named Rules
**The Sunset Means Now Rule.** Warm Amber marks only what is current: today, the page you are on, the comment you were linked to. It is a rule or bar, never a fill, button, or text color. If it isn't happening now or here, it isn't amber.

**The Follow the Blue Rule.** Harbor Blue is for things a reader can follow (links, kickers that link, active votes). Headings and buttons are Deep Teal-Navy, never Harbor Blue, so blue stays a reliable signal.

## Typography

**Display Font:** Archivo (with 'Arial Narrow', sans-serif), loaded from Google Fonts with its width axis (62–125) and weights 400–800
**Body Font:** Newsreader (with Georgia, serif), optical sizes 6–72, weights 400–700, roman and italic

**Character:** A condensed, assertive grotesque for headlines and labels against a warm, bookish text serif. The narrow Archivo gives headlines a newspaper's density; Newsreader slows the eye down for the story itself.

### Hierarchy
- **Masthead** (800, clamp(2rem, 6.4vw, 4.4rem), 0.9, width 68%): the "Firelands Current" nameplate only. The footer and admin header reuse it smaller.
- **Display** (700, clamp(2.6rem, 6.2vw, 4.75rem), 0.98, width 66%): the homepage lead story's headline.
- **Headline** (700, clamp(2.4rem, 5.6vw, 3.9rem), 1, width 66%): story headlines. Page titles use the global h1 (clamp(2.4rem, 6vw, 4rem), 1.05, width 72%).
- **Title** (700, 1.75rem, 1.05, width 72%): section headings (h2). Admin h2 drops to 1.45rem.
- **Title small** (700, 1.3rem, 1.12, width 72%): list headlines (h3) on the homepage, events, and section lists; the rail uses 1.35rem.
- **Lede** (Newsreader 400, clamp(1.15rem, 2.2vw, 1.3rem), 1.5, max 36em): the summary under a headline; the homepage lead runs it a size larger.
- **Body read** (Newsreader 400, 1.22rem, 1.65, max 36em, about 70 characters a line): story text. Blockquotes are italic at 1.1em with a Harbor Blue left rule.
- **Body scan** (Archivo 400, 1rem): interface text, forms, navigation, comments, admin.
- **Label** (Archivo 650, 0.95rem, width 92%): kickers, buttons, form labels (600).
- **Meta** (Archivo 400, 0.9rem, width 95%, Muted Blue-Gray): bylines, dates, places under list headlines, captions (0.85–0.92rem).
- **Date numeral** (Archivo 800, 3rem, 0.95, width 62%, tabular figures): the day number in event lists.

### Named Rules
**The Scan and Read Rule.** Archivo for what readers scan, Newsreader for what they read. A headline, label, date, or button is never in Newsreader; a story paragraph or lede is never in Archivo. Captions are Archivo because they are scanned.

**The Narrow Headline Rule.** Headings run Archivo at 62–72% width with tight leading (0.95–1.1), slight negative tracking, and `text-wrap: balance`. Normal-width Archivo is for body and controls, not headlines.

## Layout

A single centered column of up to 1180px (`--wrap`) with a 1.25rem gutter on each side, on a Cool Off-White page. Main content gets 2.25rem above and 5rem below.

- **Homepage:** a two-to-one grid (lead story and a "Latest" rail divided by a vertical rule, 3rem gap), a full-bleed Pale Aqua Mist "Coming up" band for events, then auto-fitting section columns (min 290px) and an "about" row. Under 860px it collapses to one column and the rail gains a 3px Deep Teal-Navy rule instead of a side rule.
- **Story page:** text column up to 760px beside a 300px ad rail (sticky ad). The rail disappears under 1100px. Story text itself is capped at 36em.
- **Lists:** items stacked with 1px Soft Rule hairlines between them; section heads carry a 3px Deep Teal-Navy rule above.
- **Forms:** single column, max 580px, 1.1rem between fields.
- **Admin:** a Deep Teal-Navy top bar, a Faint Aqua Wash sidebar of sections with Lucide icons, content to the right; under narrow widths the sidebar becomes a horizontally scrolling strip.
- **Breakpoints:** 1100px (story rail drops), 860px (homepage single column), 700px (masthead menu button, filter tabs scroll sideways, footer to one column), 460px (smaller nameplate, dateline hidden), 360px (menu button label hidden).
- **Full-bleed bands** use `box-shadow: 0 0 0 100vmax` plus `clip-path` so they reach the viewport edges without horizontal scroll.

## Elevation & Depth

The system is flat. There are no drop shadows anywhere; depth is conveyed by tinted bands (Pale Aqua Mist and Faint Aqua Wash against Cool Off-White), White cards on the off-white page, and rules. The only `box-shadow` values in use are structural: a 2px white ring behind focus outlines, inset borders for invalid fields, the full-bleed band trick, and the amber "now" bars (inset 3px top on today's calendar cell, a -4px left bar on a linked comment).

### Named Rules
**The Flat Paper Rule.** Surfaces never float. If something needs to stand apart, give it a tinted band, a White card with a Soft Rule border, or a heavy rule above it; never a shadow, blur, or glow.

## Shapes

Nearly square. Interactive elements, cards, inputs, and menus use 2px corners; fieldsets, media-library tiles, and some admin inputs use 3–4px. Photographs are unrounded and cropped to fixed ratios (16:9 lead images, 3:2 thumbnails) with a Pale Aqua Mist placeholder behind them. The only round shapes are status pills and filter chips in the admin tools and the "sample" ad tag (999px).

The recurring form is the rule: a 3px Deep Teal-Navy line over a section, byline, related-stories block, or date; a 3px underline on the current navigation item or filter tab; and 1px hairlines between items.

### Named Rules
**The Rule Over Box Rule.** Group content with a rule above it before reaching for a bordered box. Cards are for forms, account panels, and admin content, not for news lists.

## Components

### Buttons
Printed and plain: solid ink-colored blocks with tight corners and no motion.
- **Shape:** nearly square (2px).
- **Primary:** Deep Teal-Navy fill, white Archivo label at 650 weight and 92% width, 0.75rem by 1.15rem padding.
- **Hover / Focus:** hover lifts to Lifted Teal-Navy; focus shows a 3px Deep Teal-Navy outline offset 2px with a white ring. No transitions.
- **Secondary:** transparent (White in admin) with a Gray-Aqua Rule border and Deep Teal-Navy text; hover fills with Pale Aqua Mist.
- **Small:** 0.45rem by 0.8rem, 0.92rem text. Admin buttons are inline-flex with a 2.25rem minimum height and an optional leading Lucide icon.

### Chips / Pills
- **Style:** admin status pills are fully rounded, 0.78rem bold text on Faint Aqua Wash (or status colors), 0.15rem by 0.55rem padding.
- **State:** public filters are not chips; they are underline tabs (see Navigation).

### Cards / Containers
- **Corner Style:** 2px.
- **Background:** White on the Cool Off-White page.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Soft Rule.
- **Internal Padding:** 1.4rem (1.3rem in admin).

### Inputs / Fields
- **Style:** White background, 1px Field Stroke Gray border, 2px corners, 0.75rem by 0.85rem padding; labels are 600-weight Archivo above the field. Message textareas switch to Newsreader at 1.05rem because people write in them.
- **Focus:** 3px Harbor Blue outline with the border turning Deep Teal-Navy.
- **Error:** Rust Red border plus an inset 1px Rust Red ring, a Rust Red message under the field, and a focused error summary at the top of the form with links to each field.

### Navigation
- **Masthead:** Deep Teal-Navy band; logo mark and the condensed nameplate on the left, the day's dateline on the right ("Sunday, November 15, 2026" over "News from Sandusky and the Firelands").
- **Main nav:** a row of Archivo 600 links in pale aqua (a raw `#d4e4e7`, a shade off Pale Aqua Mist) under a Lifted Teal-Navy hairline; hover turns white with a muted underline, the current page gets a 3px Warm Amber underline. Search sits at the right.
- **Mobile (under 700px):** the nav folds behind a bordered "Menu" button; open, links stack with a left Warm Amber bar for the current page.
- **Filter tabs:** text tabs over a Gray-Aqua Rule baseline; Muted Blue-Gray at rest, Deep Teal-Navy with a 3px Deep Teal-Navy underline when current; on phones they scroll sideways instead of wrapping.
- **Footer:** Pale Aqua Mist, the nameplate small, a three-column link grid in Deep Teal-Navy, and a fine-print line under a rule.

### Event Date Block (signature)
Each event in the homepage "Coming up" band and the events list leads with a date block: a 3px Deep Teal-Navy rule on top, a large condensed day numeral in tabular figures, and the weekday and month in small bold type below. Today's events swap the rule to Warm Amber and say "Today." Cancelled events strike through their headline in Muted Blue-Gray.

### Kicker (signature)
Above a headline, the place in Harbor Blue (650 weight) followed by the section in Muted Blue-Gray after a thin vertical rule: "Sandusky | Schools." It says where a story happened and what kind it is; it is never decoration above a page title.

### Ads
Ads sit in defined slots: a Faint Aqua Wash band under the masthead, a 300px rail on story pages, billboards between homepage sections. Each carries a small Muted Blue-Gray label ("Advertisement," "Sponsored," or "From Firelands Current"). Native listings sit among stories with a Faint Aqua Wash fill and a Field Stroke Gray left bar so they never pass as reporting.

## Do's and Don'ts

### Do:
- **Do** use the CSS custom properties in `src/styles/tokens.css` (`var(--deep)`, `var(--channel)`, …) rather than raw hex values.
- **Do** set headings in Archivo at 62–72% width, weight 700, tight leading, Deep Teal-Navy, with `text-wrap: balance`.
- **Do** set story text and ledes in Newsreader, capped at 36em.
- **Do** head a section with a 3px Deep Teal-Navy rule and separate list items with 1px Soft Rule hairlines.
- **Do** reserve Warm Amber for what is current: today, the current page, a linked comment.
- **Do** keep every interactive corner at 2px and every focus state a 3px outline with a white ring.
- **Do** keep tap targets at least 24px tall (the footer pads its links for WCAG 2.5.8).
- **Do** give images a Pale Aqua Mist placeholder and a fixed aspect ratio.

### Don't:
- **Don't** add drop shadows, glows, blurs, or gradients.
- **Don't** use Warm Amber for text, fills, or buttons; it fails contrast on light backgrounds and dilutes its meaning.
- **Don't** color headings or buttons Harbor Blue; blue means "you can follow this."
- **Don't** put news lists in cards or bordered boxes; use rules.
- **Don't** use Newsreader for labels, navigation, buttons, or dates, or Archivo for story paragraphs.
- **Don't** round corners beyond 4px except status pills.
- **Don't** add `<style>` elements, inline event handlers, or third-party font, script, or style origins outside the Content Security Policy.
- **Don't** let ads, sponsored listings, or house notices borrow headline styling or appear on forms, account pages, dashboards, or admin pages.
