# AGENTS.md

Guidance for AI coding agents working on Firelands Current, an independent local newspaper for Sandusky, Ohio, live at `https://firelandscurrent.com`. [README.md](README.md) describes the features in depth; this file covers what an agent needs to work safely and consistently.

## Stack

- **Astro 7** in server output mode (`astro.config.mjs`), deployed with the `@astrojs/cloudflare` adapter to **Cloudflare Workers**
- **D1** (SQLite) database bound as `DB`; **R2** bucket bound as `MEDIA` for media library images; both configured in `wrangler.jsonc`
- **Better Auth** for accounts and sessions (`src/lib/auth.ts`, served at `/api/auth/*`)
- **TypeScript** in strict mode; **marked** renders story Markdown
- Node.js 24 or later

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at `http://127.0.0.1:4321` |
| `npm run check` | Type-check with `astro check` |
| `npm run build` | Production build into `dist/` |
| `npm run test:body` | Isolated tests for the bounded request-body readers |
| `npm run test:preview` | Isolated regression tests for safe story previews and their endpoint |
| `npm run test:media-metadata` | Isolated tests for upload metadata stripping and failed-upload cleanup |
| `npm run hooks:install` | Once per clone: enable the secret-scanning pre-commit and pre-push hooks and fetch the pinned Gitleaks (bypass and details: "Secret scanning" in README.md) |
| `npm run test:secret-scan` | Isolated tests for the secret-scanning hooks and their fail-closed paths |
| `npm run db:migrate:local` | Apply D1 migrations to the local database under `.wrangler/` |
| `npm run db:seed:demo` | Load fictional demo stories and discussions; only for a throwaway database (see below) |
| `npm run cf:types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |

Run `npm run check` and `npm run build` before considering a change done. **Running `npm run check` while the dev server is up breaks the dev server** (client scripts start returning 404); restart `npm run dev` afterwards.

Local setup needs `.dev.vars` copied from `.dev.vars.example` with a real `BETTER_AUTH_SECRET`. `.dev.vars` is ignored by Git; never commit secrets.

The local D1 database is kept matching production content. Don't load `scripts/seed-demo.sql` or `scripts/seed-ads-demo.sql` into it, and delete any rows you create while testing.

## Layout

```
src/
  middleware.ts      www → apex redirect, session lookup, suspension check, security headers
  env.d.ts           App.Locals (user, session, staffRole), Cloudflare.Env, __APP_VERSION__
  layouts/           BaseLayout (public site), AdminLayout (/admin)
  components/        Shared Astro components (ads, forms, news and event editors, media picker, comments)
  lib/               Data access and domain logic, one module per area
  pages/             Routes; pages/api/** are form-post endpoints
migrations/          Numbered D1 migrations (0001_auth.sql …)
scripts/             Demo seed SQL; auth-schema.ts only generated the initial auth migration
docs/                Newsroom guides (news-sources.md)
```

## Conventions

- **Data access** goes through `src/lib/*` modules that import `env` from `cloudflare:workers` and use `env.DB.prepare(...).bind(...)` with bound parameters. Never interpolate user input into SQL.
- **Timestamps** are stored as Unix milliseconds (`Date.now()`, or `unixepoch() * 1000` in SQL).
- **Auth state** comes from `Astro.locals` / `locals` (`user`, `session`, `staffRole`), set by `src/middleware.ts`. Suspended users are treated as signed out.
- **Admin sections** are declared in `ADMIN` in `src/lib/admin.ts`. Admin pages call `requireSection(Astro, ADMIN.x)`; admin endpoints check `canAccess(locals.staffRole, ADMIN.x)`. A new content area adds an entry there, reuses those roles, and gets a sidebar icon in `SECTION_ICONS` in `AdminLayout.astro`.
- **API endpoints** are `APIRoute` handlers that accept form posts: check the user and role, reject cross-origin requests with `sameOrigin(request)` from `src/lib/forum.ts`, read fields through `cleanText`, validate ids with a regex, and answer with a `303` redirect back to the page. Return plain-text error responses with the right status (400, 403, 404).
- **Request bodies** are read through `readForm`/`readText` from `src/lib/request-body.ts`, never `request.formData()` or `request.text()` directly: they count streamed bytes (not Content-Length), return 413/415/400 before any parsing or database work, and take a per-endpoint limit (`FORM_BYTES`, `STORY_FORM_BYTES`, `uploadFormBytes(fileBytes)`). Run `npm run test:body` when changing them.
- **Story previews** are the plain-text POST exception: `/api/admin/news/preview` requires `ADMIN.news` access and `sameOrigin`, bounds the streamed UTF-8 body before rendering, and returns HTML with `Cache-Control: no-store`. Both EasyMDE modes use `createStoryPreview` in `src/scripts/story-preview.ts` and the public `renderBodyBlocks` renderer in `src/lib/news.ts`. Preserve raw-HTML escaping and existing-library-only images; never fall back to EasyMDE's default HTML renderer. Preview requests must not save or log story text. Run `npm run test:preview` when changing this path.
- **Content Security Policy** (`src/lib/response-headers.ts`, report-only while `CSP_ENFORCE` is false) allows scripts only by per-response nonce. Every `<script is:inline>` carries `nonce={Astro.locals.cspNonce}`; don't add inline event handlers, `javascript:` URLs, `<style>` elements, or `eval`. A new third-party origin goes into the policy, its tests, and the Privacy Policy. Run `npm run test:headers` and `npm run test:csp-report` when changing it.
- **Editor assets** are bundled, not loaded from a CDN: `NewsEditor.astro` imports `easymde` (pinned to an exact version) and its stylesheet, passes `autoDownloadFontAwesome: false`, and swaps the toolbar icons for Lucide. Keep the editor free of third-party script, style, and font origins.
- **Admin changes to users, businesses, ads, and media** are recorded in `admin_audit_log` (see `auditStatement` in `src/lib/users.ts`, `adAudit`, `mediaAudit`); keep new admin actions audited the same way.
- **Images** go through the media library (`src/lib/media.ts`): every file in R2 has a `media` row with a required credit, and stories, events, and ads refer to library items. Never delete an R2 object that a story, event, or ad might use; use `mediaUsage` first. Story Markdown only renders `/media/…` images that exist in the library. Uploads go through `checkUpload`, which rebuilds each file without metadata (see the README's policy table) and refuses files it can't parse; save new uploads with `batchWithUploads` so a failed write removes only their unreferenced files. Run `npm run test:media-metadata` when changing either.
- **Ads** never appear on forms, account pages, dashboards, or the admin panel. Placements are defined in `PLACEMENTS` in `src/lib/ads.ts`.
- **Styling** is plain CSS in the layouts and pages; there is no CSS framework.
- **Icons** in the admin panel come from Lucide via `@lucide/astro` (`import { Plus } from '@lucide/astro'`), rendered as inline SVG on the server. Use current icon names, not the deprecated aliases (`Trash`, not `Trash2`). Icons sit before a button's or heading's text and are decorative; the text carries the meaning.
- Writing or sourcing news stories: read [docs/news-sources.md](docs/news-sources.md) first. It covers the editorial rules, which sources to trust, and how stories get into the database.
- Dated reporting reviews, evidence, content snapshots, and publication records belong in the separate project library, not `docs/` or `.wrangler/`. Keep their utilities in `scripts/` and resolve the library through `scripts/project-library.mjs` or `scripts/project_library.py`; the README documents `FIRELANDS_PROJECT_DIR` and the dated folders.
- Match the surrounding code: comment density, naming, and idiom. Comments explain why, not what.
- Keep `README.md` current when behavior an operator or editor would notice changes.
- Keep the Privacy Policy (`src/pages/privacy.astro`) accurate: update it in the same change when you add or change what data is collected, stored, shown publicly, or sent to a third party (a new analytics tag, cookie, form field, or sign-in provider).

## Database migrations

- Add a new numbered file in `migrations/`, using the next number after the highest existing migration; never edit a migration that has shipped.
- Apply locally with `npm run db:migrate:local`. Update `scripts/seed-demo.sql` or `scripts/seed-ads-demo.sql` if the schema change affects demo data.
- Production migrations are applied deliberately with `npx wrangler d1 migrations apply DB --remote`. Don't run `--remote` commands unless the user asks.

## Deployment

The `main` branch is connected to Cloudflare Workers Builds: **every push to `main` builds and deploys to production** at `https://firelandscurrent.com`. Confirm with the user before pushing, and make sure any new migrations are applied to the production database before or alongside the deploy.

## Versioning

The site uses [Semantic Versioning](https://semver.org/). The single source of truth is `version` in `package.json`; `astro.config.mjs` injects it at build time as `__APP_VERSION__`, and the footer in `BaseLayout.astro` displays it.

To release a version:

1. Bump the version with `npm version <major|minor|patch> --no-git-tag-version` (updates `package.json` and `package-lock.json`).
2. Add a section to `CHANGELOG.md` under the new version and date.
3. Commit with the subject `vX.Y.Z - <summary>` (for example, `v1.17.1 - Define the coverage area and document regional sources`), then tag the commit `vX.Y.Z` (lightweight) and push the tag with the branch.

Use **patch** for fixes, **minor** for new features or sections, and **major** for changes that break existing URLs, accounts, or data.

## Git

- Track outstanding work in [GitHub Issues](https://github.com/jmusick/firelands-current/issues), not a local TODO.md or duplicate vault backlog. Read the relevant issue and check for related existing issues before creating new work.
- Preserve issue evidence, acceptance criteria, and audit dates; dated findings require current verification. Category labels group work; `priority:1`, `priority:2`, and `priority:3` mean address first, next, and longer term within each category. Earlier audit follow-ups remain unprioritized until reviewed.
- Reference issue numbers in implementation summaries. Close an issue only when its acceptance criteria and required validation are satisfied; distinguish local completion from production deployment.

- Commit messages are short imperative summaries (for example, "Redirect www to canonical domain"). Release commits use the `vX.Y.Z - <summary>` form above.
- Do not add `Co-Authored-By` or other AI attribution trailers to commits.
