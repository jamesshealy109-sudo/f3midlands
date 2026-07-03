# F3 Midlands

A production Astro website for F3 Midlands, configured for GitHub Pages using GitHub Actions.

## Local commands

```bash
npm install
npm run dev
npm run build
```

## GitHub Pages configuration

Repository Settings → Pages → Build and deployment → Source: GitHub Actions.

The deployment workflow is in `.github/workflows/deploy.yml`.

## Editing AO data

AO data lives in `src/data/aos.json`.

Each AO includes:

- `name`
- `region`
- `type`
- `days`
- `time`
- `address`
- `notes`
- `sourceStatus`

Region counts are calculated from this file automatically.

## Public URL

https://jamesshealy109-sudo.github.io/f3midlands/
