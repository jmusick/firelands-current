# Accessible publishing

Practical rules for writing and publishing stories, events, and ads so readers using screen readers, keyboards, magnification, or captions can use them. Read this with [news-sources.md](news-sources.md). The public statement is at `/accessibility`; update it if these rules or the site's known limits change.

## Images

- Every media library image needs an alt text decision: describe what the image shows, or tick **This image is decorative** when it adds nothing a reader would miss. The library refuses both, neither, or placeholder text such as "photo" or a file name (`validateMediaDetails` in `src/lib/media.ts`, covered by `npm run test:media-alt`).
- Write alt text for the story's purpose. A photo of a council meeting that illustrates a vote gets "Council members raise their hands to approve the budget," not "council meeting." Keep it under 300 characters and skip "image of" and "photo of."
- Put the credit and caption in their own fields. Alt text describes the picture; the caption adds context for everyone. Do not repeat the caption as alt text.
- A story can override the alt text for one use by writing different text between the brackets of the Markdown image.
- Text inside an image (a flyer, a sign, a schedule) must also appear as text in the story body or caption.
- Use the **Needs alt text** filter at `/admin/media?alt=missing` to clear older images that have no decision.

## Story structure

- The headline is the page's only `h1`. Start headings in the body at `##` and go down one level at a time (`###` under `##`). Do not skip levels or use bold text as a heading.
- Use headings to mark real sections of a long story, not to style a line.
- Write link text that names the destination: "the city's 2027 budget proposal," not "click here" or a bare address. Two links with the same text should go to the same place.
- Use real Markdown lists for lists. Spell out abbreviations on first use.
- Do not rely on color, position, or emoji to carry meaning ("see the red line below").

## Tables

- Write tables in Markdown with a header row so each column has a label. Keep them rectangular, with no merged or empty cells.
- Add a sentence before the table saying what it shows. Keep tables to a few columns; wide ones are hard to read on a phone.

## Charts and data

- Do not publish a chart as an image alone. State the main finding in the text, and include the underlying numbers as a table or list in the story.
- Give the chart image alt text that says what kind of chart it is and what it shows, and point to the data table for details.
- Do not use color alone to separate series. Label lines or bars directly.

## Audio and video

The site carries no audio or video today. If that changes, publish these with the media:

- Captions for all recorded video with speech, and a transcript for audio and video.
- A text description, or narration that covers it, when important information appears only on screen.
- No autoplay with sound, and controls a keyboard can operate.
- Captions or a transcript for live streams, posted afterward.

Update the Privacy Policy and the accessibility statement when a player or third-party host is added.

## Feedback

Readers report accessibility problems through the contact form or contact@firelandscurrent.com. Treat a missing alt text, unreadable table, or broken keyboard path in a published story as a correction-level fix: repair it and reply to the reader.
