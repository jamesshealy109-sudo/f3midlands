# F3 Midlands

Complete Astro repository for the F3 Midlands website, configured for GitHub Pages at:

`https://jamesshealy109-sudo.github.io/f3midlands/`

## What this repository does

The site continues to render from `src/data/aos.json`, but that file is rebuilt from the official F3 Nation API before every production build. The API key is never sent to a visitor's browser and is never written into the generated site.

The sync keeps only active, public 1st F workout records associated with these Midlands regions:

- Lexington
- Columbia
- Lake Murray
- Camden
- Saluda

Individual recurring event records are combined into one AO with a schedule array. The checked-in `aos.json` remains a fallback for local development and protects the site from being erased by an invalid API response.

## One-time GitHub setup

1. Rotate the API key that was shared in chat and generate a new key.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
3. Create a repository secret named exactly `F3_NATION_API_KEY`.
4. In **Settings → Pages**, set the source to **GitHub Actions**.
5. Replace the repository contents with this package and push to `main`.

The workflow runs on every push, manually, and every six hours.

## Local development

```bash
npm install
npm run dev
```

Create `.env` from `.env.example` to test a live local API sync. Without a key, development still uses the checked-in fallback data.

## Commands

```bash
npm run sync:aos       # Pull and transform official F3 Nation events
npm run sync:aos:test  # Validate the transformer with the included fixture
npm run build          # Sync, then build the production site
npm run build:static   # Build only from the checked-in fallback JSON
npm run check          # Run Astro/TypeScript checks
```

## Important files

- `scripts/sync-f3-aos.mjs` — API client, filtering, transformation, and safety checks
- `src/data/aos.json` — generated AO directory plus fallback data
- `src/pages/index.astro` — complete site page
- `src/styles/global.css` — complete site styling
- `.github/workflows/deploy.yml` — scheduled API refresh and GitHub Pages deployment
