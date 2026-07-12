# F3 Midlands Website — F3 Nation Source of Truth

This repository builds the F3 Midlands website from the official F3 Nation API.

## What is authoritative

The local repository does not maintain a second AO directory. During every GitHub Pages build, the sync script retrieves official F3 Nation organization, AO, event, and map-location data and generates `src/data/aos.json`.

The following values come from F3 Nation:

- Active AO membership and AO count
- Official organization/region assignment
- AO name and description
- AO website, email, phone, logo, and social links
- Active/public 1st F events
- Workout type, day, start time, end time, and event description
- Location ID, name, full address, latitude, and longitude
- Google directions links generated from F3 Nation coordinates
- Official F3 map links generated from the same coordinates

There is no merge with the old hand-maintained AO JSON and no city/name heuristic used to create AO records.

## GitHub secret

Create a repository Actions secret named exactly:

```text
F3_NATION_API_KEY
```

## Site scope

The workflow contains:

```text
F3_TARGET_ORG_NAMES=Lexington,Columbia,Lake Murray,Camden,Saluda
```

These names only select which official F3 organizations and their descendant AOs belong on this site. All AO content and counts still come from F3 Nation. The resolver supports official names such as `F3 Lexington`.

When an organization name is ambiguous, replace the names with exact official IDs:

```text
F3_TARGET_ORG_IDS=123,456,789
```

## Deployment behavior

The build runs every six hours, on pushes to `main`, and on manual workflow runs. If the F3 API sync fails, the new deployment is stopped. GitHub Pages keeps serving the last successful deployment rather than publishing stale or partially generated AO data.

## Local validation

```bash
npm ci
npm run sync:aos:test
npm run build:static
```

For a live local build, copy `.env.example` to `.env`, add a valid API key, and run:

```bash
npm run build
```
