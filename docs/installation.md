# Consumer installation guide

This guide takes a Next.js repository from nothing to a working visual-regression setup: an
authoritative baseline published from the default branch, and pull requests compared against the
exact baseline for their base commit.

Prerequisites: Node.js 22, a Next.js app with a production build that prerenders routes into
`.next/prerender-manifest.json`, and GitHub Actions.

## 1. Install the package from GitHub

The toolkit is not published to an npm registry — it installs directly from this repository, and
consumers track whatever is on `main`:

```bash
npm install --save-dev github:BrandonMathis/visual-regression-toolkit
```

Commit `package.json` and the lockfile. The lockfile pins the exact commit that was installed;
`npm ci` reproduces it. The reusable workflows verify before running anything that the dependency
is sourced from this repository and that its package version matches the version the workflows
pair with, failing with `TOOLKIT_VERSION_MISMATCH` on drift — if that happens after the toolkit
moves, refresh your pin with `npm install github:BrandonMathis/visual-regression-toolkit`. If a
git tag exists and you prefer a fixed ref over `main`, install
`github:BrandonMathis/visual-regression-toolkit#<tag>` and reference the workflows at the same
tag. See [release.md](release.md) for the coupling table.

## 2. Add configuration

Create `visual-regression.config.ts` at the repository root:

```ts
import { defineVisualConfig } from '@thisdot/visual-regression';

export default defineVisualConfig({
  framework: {
    type: 'next-prerender',
    manifestPath: '.next/prerender-manifest.json',
  },
  commands: {
    build: 'npm run build',
    start: 'npm run start -- --hostname 127.0.0.1',
  },
  server: {
    origin: 'http://127.0.0.1:3000',
    readinessPath: '/',
    startupTimeoutMs: 120_000,
  },
  routes: {
    include: ['/**'],
    exclude: [],
    additional: [],
  },
  clock: {
    environmentVariable: 'VISUAL_TEST_DATE',
  },
  capture: {
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    fontChecks: [],
    readinessSelectors: [],
    masks: [],
    externalRequests: {
      default: 'block',
      allow: ['self', 'data:', 'blob:'],
    },
    screenshot: {
      fullPage: true,
      threshold: 0.2,
    },
  },
});
```

Everything except `framework`, `commands`, and `server` is optional; the values above are the
defaults. The server origin must be loopback (`127.0.0.1` or `localhost`) in version 1. Validation
is strict: unknown fields, duplicate project names, unsafe paths, and unresolved dynamic route
parameters are rejected, and an empty final route set is an error.

Keep production credentials out of this file and out of the visual build. Use harmless test values
and disable external side effects — the visual build runs with no secrets.

## 3. Ignore generated output

Add to `.gitignore`:

```gitignore
/.visual-regression/
/playwright-report/visual/
/test-results/visual/
```

Baselines used by CI are workflow artifacts, not committed screenshots. Never commit screenshot
files for CI comparison.

## 4. Add the baseline caller

Create `.github/workflows/visual-baseline.yml`:

```yaml
name: Visual Baseline

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 8 1 * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  baseline:
    uses: BrandonMathis/visual-regression-toolkit/.github/workflows/visual-baseline.yml@main
    with:
      config-path: visual-regression.config.ts
      node-version: '22'
      retention-days: 90
```

This publishes an immutable baseline artifact for every default-branch push. The monthly schedule
refreshes artifacts in repositories without recent default-branch changes, since artifacts expire
after 90 days. `workflow_dispatch` lets you seed or re-publish manually.

## 5. Add the comparison caller

Create `.github/workflows/visual-regression.yml`:

```yaml
name: Visual Regression

on:
  pull_request:
    branches: [main]

permissions:
  actions: read
  contents: read

concurrency:
  group: visual-regression-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}
  cancel-in-progress: true

jobs:
  compare:
    uses: BrandonMathis/visual-regression-toolkit/.github/workflows/visual-regression.yml@main
    with:
      config-path: visual-regression.config.ts
      baseline-workflow-file: visual-baseline.yml
      node-version: '22'
      visual-diffs-are-informational: true
```

Do not add `secrets: inherit` — the comparison job executes pull-request code and must never
receive secrets. Both callers reference the reusable workflows at `@main`: the workflows and the
package move together on this repository's `main` branch. If you installed the package at a git
tag instead, reference the workflows at that same tag; keep the two refs consistent either way
([release.md](release.md)).

## 6. Seed and verify

1. Merge the configuration and both workflow callers to the default branch.
2. Allow the push workflow, or a manual baseline run, to publish the first exact-SHA baseline.
3. Confirm the artifact contains `baseline-manifest.json` and all expected screenshots
   (`screenshots/desktop/`, `screenshots/tablet/`, `screenshots/phone/`).
4. Open a no-change PR and confirm a clean comparison (`pass`, exit `0`).
5. Add a temporary CSS change and confirm a `visual-diff` result, a downloadable report, and an
   advisory (green with warnings) workflow conclusion.
6. Trigger a temporary build failure and confirm the infrastructure error remains blocking (red).
7. Revert the temporary changes.

Do not make the comparison a required check until the initial baseline exists — PRs opened before
the first baseline fail with `BASELINE_NOT_FOUND`.

## 7. Operate and upgrade

- Publish a baseline on every default-branch push, on the monthly schedule, and on manual request.
- Review the GitHub job summary and download the HTML report when a PR shows differences.
- Upgrade by refreshing the git dependency (`npm install github:BrandonMathis/visual-regression-toolkit`)
  and committing the lockfile; the `@main` workflow refs move automatically. If a run fails with
  `TOOLKIT_VERSION_MISMATCH`, the workflows on `main` have moved ahead of your locked commit —
  refresh the dependency the same way.
- Regenerate baselines after any browser, container, stabilization-default, or visual-contract
  change.
- For a PR that changes the visual contract (config hash), use the documented explicit check
  waiver, merge it, and wait for the resulting default-branch baseline before normal PR
  comparisons resume. See [operations.md](operations.md).
- Roll back by pinning the git dependency and both workflow refs to an earlier commit or tag
  together (`npm install github:BrandonMathis/visual-regression-toolkit#<ref>` plus `@<ref>` in
  the callers), then publishing a compatible baseline.
