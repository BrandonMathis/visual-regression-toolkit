# Visual Regression Toolkit

Shared Playwright visual regression testing for internal Next.js websites. It discovers prerendered
routes from `.next/prerender-manifest.json`, captures each route in Chromium at desktop, tablet, and
phone sizes, and writes a small route/viewport summary for pull-request comments.

## Install

```sh
npm install --save-dev github:BrandonMathis/visual-regression-toolkit
```

The Git dependency builds `dist/` through its `prepare` script. The toolkit and its reusable
workflows track `main`; it is not published to npm.

## Configure

Create `playwright.visual.config.ts` in the consumer repository:

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

All fields are optional. Defaults are dark color scheme, port `3000`, the start command shown
above, and no font waits or excluded route prefixes.

Add scripts:

```json
{
  "scripts": {
    "test:visual": "run-visual",
    "test:visual:update": "run-visual --update"
  }
}
```

`run-visual` builds the site before testing. In CI it runs Playwright directly. Locally it uses the
pinned Playwright Docker image so Linux font rasterization matches CI; Docker is therefore required
for comparable local screenshots.

Generate and commit the bootstrap baselines:

```sh
npm run test:visual:update
git add tests/visual/__screenshots__
```

Screenshot names and locations remain compatible with `thisdot/workshop-website`: `/` becomes
`home.png`, nested route separators become `--`, and files live under the `desktop`, `tablet`, and
`phone` directories.

## Add the reusable workflows

`.github/workflows/visual-baseline.yml`:

```yaml
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

`.github/workflows/visual-regression.yml`:

```yaml
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

Both workflows accept `node-version` (default `24`). The PR workflow looks for the latest successful
run of the consumer's `visual-baseline.yml`, overlays its `visual-baseline-screenshots` artifact on
the committed bootstrap screenshots, uploads the Playwright HTML report, and updates one sticky PR
comment (`<!-- visual-regression-report -->`). Visual differences are advisory; build, server,
broken-image, and other non-diff failures still fail the check.

The design deliberately uses the latest main baseline rather than an exact base SHA. It does not
verify artifacts or couple package and workflow versions. With two trusted, low-traffic internal
sites, rerunning after main settles is the intended remedy for a stale comparison.

## Update baselines

Run `npm run test:visual:update` and commit the changed screenshots when a visual change is intended.
Merges to `main` also publish a fresh 90-day baseline artifact for subsequent pull requests.

The Playwright package and container are pinned to `1.61.1`. Update that version consistently in
`package.json`, `src/config.ts`, and the three workflows, then refresh consumer baselines.
