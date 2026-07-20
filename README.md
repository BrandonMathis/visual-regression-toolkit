# Visual Regression Toolkit

A shared Playwright toolkit for visual regression testing of prerendered Next.js pages. It discovers
routes from Next.js's prerender manifest, captures full-page Chromium screenshots at three viewport
sizes, and provides reusable GitHub Actions workflows for baseline publishing and pull-request
reports.

## What it does

- Tests every eligible route in `.next/prerender-manifest.json`.
- Captures desktop (`1440×900`), tablet (`768×1024`), and phone (`375×812`) screenshots.
- Waits for configured fonts, images, and video posters before capture; it reports unloaded images
  as failures.
- Blocks external network requests so screenshots depend on assets served by the local site.
- Uses the same pinned Linux Playwright image locally and in CI to avoid host font-rendering diffs.
- Writes a Playwright HTML report plus a route-and-viewport summary suitable for PR comments.

## Requirements

- A Next.js site that produces `.next/prerender-manifest.json` during `next build`.
- Node.js 22 or later.
- Docker for local, CI-comparable screenshots. GitHub Actions workflows already run inside the
  required Playwright container.
- A production start command that serves the built site on a local port.

## Install

### With a coding agent

Ask your coding agent:

```text
Install this tool: https://github.com/BrandonMathis/visual-regression-toolkit/blob/main/install.md
```

The agent will check that the repository is compatible before making changes, then install and
configure the package and GitHub Actions workflows.

### Manually

Install the package from GitHub as a development dependency:

```sh
npm install --save-dev github:BrandonMathis/visual-regression-toolkit
```

The package is not published to npm. Its `prepare` script builds `dist/` during a Git dependency
installation. Pin the Git dependency to a commit or tag when reproducible consumer installs matter.

Add these scripts to the consumer's `package.json`:

```json
{
  "scripts": {
    "test:visual": "run-visual",
    "test:visual:update": "run-visual --update"
  }
}
```

## Configure the consumer

Create `playwright.visual.config.ts` at the consumer repository root:

```ts
import { createVisualConfig } from '@thisdot/visual-regression';

export default createVisualConfig({
  fonts: ['400 16px Manrope', '600 48px "Bricolage Grotesque"'],
  colorScheme: 'dark',
  port: 3000,
  startCommand: 'npm run start -- --hostname 127.0.0.1',
  exclude: ['/drafts'],
});
```

All options are optional:

| Option         | Default                                 | Purpose                                                                     |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `fonts`        | `[]`                                    | CSS font descriptors passed to `document.fonts.load()` before capture.      |
| `colorScheme`  | `'dark'`                                | Emulated `prefers-color-scheme`: `'dark'`, `'light'`, or `'no-preference'`. |
| `port`         | `3000`                                  | Port used for the local server and Playwright base URL.                     |
| `startCommand` | `npm run start -- --hostname 127.0.0.1` | Command that serves the already-built site.                                 |
| `exclude`      | `[]`                                    | Route-prefixes to omit, for example `['/drafts']`.                          |

The runner builds the site before starting the configured server. Routes are included when they have
a non-null `dataRoute` in the prerender manifest; `/_` routes and configured prefixes are skipped.
Screenshot files are written under `tests/visual/__screenshots__/` by viewport. The root route is
`home.png`; nested-route separators become `--`.

## Run locally

Create the first baseline, or intentionally update an existing one:

```sh
npm run test:visual:update
git add tests/visual/__screenshots__
git commit -m "Update visual baselines"
```

Compare the current site with its baseline:

```sh
npm run test:visual
```

Both commands run inside the pinned Playwright Docker image. This is intentional: macOS and Linux
can rasterize fonts differently, so host-browser screenshots are not CI-comparable. If Docker is
unavailable, `CI=1 npm run test:visual` forces a host-only run, but do not use its screenshots as CI
baselines.

On failures, inspect `playwright-report/index.html`. The custom reporter also writes
`test-results/visual-changes.json` and `test-results/visual-summary.md`.

## GitHub Actions

Add a baseline workflow to publish screenshots whenever `main` changes:

```yaml
# .github/workflows/visual-baseline.yml
name: Visual Baseline

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  baseline:
    uses: BrandonMathis/visual-regression-toolkit/.github/workflows/visual-baseline.yml@main
```

Add a PR workflow to compare with the latest main baseline:

```yaml
# .github/workflows/visual-regression.yml
name: Visual Regression

on:
  pull_request:
    branches: [main]

permissions:
  actions: read
  contents: read
  pull-requests: write

jobs:
  compare:
    uses: BrandonMathis/visual-regression-toolkit/.github/workflows/visual-regression.yml@main
    with:
      preview-app-domain: example.amplifyapp.com # optional
```

Both reusable workflows accept an optional `node-version` input (default: `24`).

### Baseline workflow

The baseline workflow runs `run-visual --update` in the pinned Playwright container and uploads
`tests/visual/__screenshots__/` as the `visual-baseline-screenshots` artifact for 90 days. After
adding the workflow, merge or push to `main` once before relying on PR comparisons.

### PR workflow

The PR workflow finds the latest successful `main` run of the consumer's
`visual-baseline.yml`. It fails if that run or its unexpired `visual-baseline-screenshots` artifact
is unavailable. It then downloads that artifact into `tests/visual/__screenshots__/`, runs the
comparison, uploads `playwright-visual-report`, and creates or updates a sticky PR comment marked
`<!-- visual-regression-report -->`.

The artifact download does not clear screenshots already present in the checkout; the artifact is
downloaded into the same directory. Keep committed snapshots current for local use, but ensure the
main baseline artifact is available for CI.

Visual differences are advisory: the workflow reports changed routes and viewports without failing
the check. Build failures, server failures, broken images, and other non-screenshot test failures
still fail the workflow.

If `preview-app-domain` is supplied, the PR comment can construct Amplify preview links. Otherwise,
it first looks for an existing Amplify deployment comment and falls back to listing routes without
links.

## Updating the toolkit

The package, Docker image, and workflows are pinned to Playwright `1.61.1`. When upgrading it,
update the dependency in `package.json`, `PLAYWRIGHT_VERSION` in `src/config.ts`, and the image tags
in all three workflows together. Regenerate consumer baselines after the upgrade.

## Troubleshooting

- **Docker is required:** Start Docker Desktop, then rerun the visual command.
- **Prerender manifest cannot be read:** Verify the config is named `playwright.visual.config.ts`
  and that the site's build command produces `.next/prerender-manifest.json`.
- **No successful main baseline exists:** Run the baseline workflow successfully on `main`; committed
  screenshots alone do not satisfy the PR workflow's artifact requirement.
- **Images fail to load:** Visual tests block third-party network requests. Serve needed assets from
  the application, or exclude routes that cannot be tested deterministically.
