# Architecture

## Stack (confirmed 2026-08-16, SETUP-001)

- **Framework:** Next.js 16 (App Router) — `apps/web`
- **Language:** TypeScript, `strict: true`
- **Styling:** Tailwind CSS v4 (PostCSS plugin), system font stack (Volvo Novum is proprietary and not used; no Google-font network dependency)
- **UI primitives:** shadcn/ui v4 (Radix base, "nova" preset, unified `radix-ui` package) under `src/components/ui`
- **Forms:** react-hook-form + zod + @hookform/resolvers
- **Unit tests:** Vitest 4 + jsdom + React Testing Library (`npm run test`)
- **E2E tests:** Playwright (`npm run e2e`, port 3100, `tests/`)
- **Scraper:** `npm run scrape` (tsx placeholder at `scripts/scrape/index.ts`; implemented later)

## No backend / database

- The site is a static, content-driven Next.js app. There is no API server or database.
- Forms run in demo mode: submissions are written to a local inbox file (`.data/inbox.json`) instead of being emailed.
- Runtime configuration via environment variables (see `apps/web/.env.example`):
  - `FORM_MODE=demo`
  - `DATA_DIR=.data`
  - `SITE_URL=http://localhost:3000`

## Repository layout

```
buchegg/
  apps/
    web/          # the product application (single app for now)
      src/
        app/      # App Router routes, root layout, loading/error/not-found
        components/
          ui/     # shadcn/ui primitives
          sections/   # page sections (from content)
          forms/      # form components
        content/  # content data (JSON), produced by the scraper
        lib/      # helpers (utils.ts with cn, formatters, etc.)
      public/
        assets/   # local images (scraped assets live here)
      tests/      # Playwright E2E specs
      scripts/    # scraper and other tooling
  memory/         # team memory files
  .opencode/      # team tooling (own package.json; do not touch)
```

## Content-driven static pages

- All pages render from content data stored in `src/content` (JSON), not from hardcoded JSX.
- The scraper (`apps/web/scripts/scrape`) will download the original site content into `src/content` and assets into `public/assets`.
- Clean URLs (e.g. `/modell/xc60`); no `/volvo-car-bern/de/` prefix.
- Images are kept (private demo use) and served locally via `next/image` with `images.remotePatterns: []`.

## Notes

- Next.js 16 conventions in use: Turbopack (default for dev/build), ESLint flat config (`eslint` script, no `next lint`), async request APIs, `error.tsx` uses `error`/`retry` props.
