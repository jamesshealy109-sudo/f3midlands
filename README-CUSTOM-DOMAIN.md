# F3 Midlands — Complete Custom-Domain Repository

This is the complete deployable repository configured for:

- `https://f3midlands.com`
- GitHub Pages via GitHub Actions
- F3 Nation as the source of truth for AO metadata, schedules, counts, locations, coordinates, and directions
- Public npm registry isolation
- No visible “AO Website” button

## Replace the repository

Keep the local `.git` folder, delete the other repository contents, then extract all files from this ZIP directly into the repository root. Commit and push to `main`.

The GitHub Actions repository secret must remain named:

`F3_NATION_API_KEY`
