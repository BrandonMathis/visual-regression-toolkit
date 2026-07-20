# Install Visual Regression Toolkit

Follow these steps in the repository where the tool should be installed.

## 1. Check compatibility before changing anything

Stop and explain what is incompatible unless all of these are true:

- `package.json` lists `next` in dependencies or devDependencies.
- The project can build with Node.js 22 or newer and has `build` and `start` npm scripts.
- This is a Git repository with a remote hosted on `github.com` and GitHub Actions can be used.
- The default branch is `main` (the reusable workflows currently use `main` for baselines).
- The project uses npm and commits a `package-lock.json`.

Also check for existing files named below. Merge compatible settings; do not silently overwrite them.

## 2. Install and configure

Run:

```sh
npm install --save-dev github:BrandonMathis/visual-regression-toolkit
```

Add these `package.json` scripts:

```json
{
  "test:visual": "run-visual",
  "test:visual:update": "run-visual --update"
}
```

Create `playwright.visual.config.ts`:

```ts
import { createVisualConfig } from '@thisdot/visual-regression';

export default createVisualConfig();
```

The defaults expect `npm run start -- --hostname 127.0.0.1` on port 3000. If that does not serve the production build, pass the correct `startCommand` and `port` to `createVisualConfig`.

Add `/playwright-report/` and `/test-results/` to `.gitignore`. Do not ignore `tests/visual/__screenshots__/`; those are the reviewable local baselines.

Create `.github/workflows/visual-baseline.yml`:

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

Create `.github/workflows/visual-regression.yml`:

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
```

## 3. Verify and report

Run the project's normal build and checks. If Docker is available, run `npm run test:visual:update` and keep the generated screenshots for user review; otherwise note that Docker is required for CI-comparable local screenshots.

Do not commit. Summarize the files changed and tell the user that `Visual Baseline` must complete successfully on `main` once before PR comparisons can work.
