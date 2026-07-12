# F3 Midlands API Fix v5

Extract this patch into the root of the F3 Midlands repository and overwrite the existing files.

Files replaced:

- `scripts/sync-f3-aos.mjs`
- `.github/workflows/deploy.yml`

## What changed

- Classifies known AOs using the existing directory even when the F3 Nation region is only `F3 Midlands`.
- Handles AO names such as `F3 Jailbreak`, `Jailbreak Bootcamp`, and punctuation differences.
- Classifies new AOs using South Carolina city and ZIP information.
- Recognizes `SC` and `South Carolina`.
- Adds South Carolina-specific diagnostics if fewer than the expected number of AOs are found.
- Changes `F3_SYNC_STRICT` to `false`, so the existing `src/data/aos.json` remains in place and the website still deploys if the API sync cannot safely replace it.
- The API key remains in GitHub Secrets and is never committed.

After extracting, commit and push both replacement files.
