# F3 Midlands public npm isolation fix v9

Cancel the currently hung GitHub Actions run before applying this patch.

Extract this ZIP into the repository root and overwrite:

- `.github/workflows/deploy.yml`
- `.npmrc`
- `package.json`
- `package-lock.json`

## Why this version is different

The workflow now:

- disables `actions/setup-node` package-manager caching;
- repairs any remaining private OpenAI registry URLs in the lockfile;
- fails immediately if any private registry markers remain;
- removes the runner's user-level `.npmrc`;
- forces `https://registry.npmjs.org/` through environment, npm config, and the `npm ci` command;
- uses a fresh `/tmp/f3midlands-npm-cache` for every run;
- does not use `--prefer-offline`.

The F3 Nation source-of-truth generation and deployment steps are unchanged.
