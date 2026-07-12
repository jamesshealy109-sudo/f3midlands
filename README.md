# GitHub Actions runner/install fix v7

Replace `.github/workflows/deploy.yml` with the included file.

Changes:

- Enables the official `setup-node` npm cache.
- Uses the existing `package-lock.json` as the cache key.
- Prints Node, npm, registry, and HTTP fetch progress.
- Limits each silent install attempt to three minutes.
- Retries once after clearing `node_modules` and verifying the npm cache.
- Leaves the F3 Nation source-of-truth sync logic unchanged.

After replacing the file, commit and push it to `main`.
