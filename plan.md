# Shared Visual Regression Toolkit: Minimal Migration Plan

## 1. Goal

Extract the visual regression system already built and proven in
[`thisdot/workshop-website`](https://github.com/thisdot/workshop-website)
([PR #79](https://github.com/thisdot/workshop-website/pull/79),
[PR #84](https://github.com/thisdot/workshop-website/pull/84)) into this shared repository so two
internal Next.js websites can reuse it without copying files.

This replaces the previous plan and the current implementation in this repository. The previous
implementation (~11,800 lines) was built for a hostile, public, multi-team world: checksummed
baseline manifests, visual-contract hashing, exact base-SHA artifact lookup, version-coupling
enforcement, machine-readable result schemas, 25 stable error codes, and a five-command CLI. None
of that matches the actual situation:

- exactly two websites, both Next.js, both very similar, both owned by us;
- internal use only, trusted committers, no hostile pull requests;
- the goal is encapsulation and reuse of code that already works — not new guarantees.

**Guiding rule: migrate the workshop-website code with the smallest generalization that lets the
second site use it. When in doubt, keep the original behavior and write less code.**

Target size: the entire toolkit — package source, workflows, tests, README — stays under ~1,000
lines. A consumer adds ~25 lines plus its committed baseline screenshots.

## 2. What the workshop-website system does (the thing being migrated)

Four source files and two workflows, verbatim from PRs #79/#84:

| Original file                             | Lines | Role                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts`                    |    73 | Three projects (desktop 1440×900, tablet 768×1024, phone 375×812), Chromium only, `webServer` block runs `npm run start`, `toHaveScreenshot` with `threshold: 0.2`, animations disabled, caret hidden, snapshots at `tests/visual/__screenshots__/{projectName}/{arg}{ext}`                                                                                                                                                               |
| `tests/visual/pages.visual.spec.ts`       |   167 | Reads `.next/prerender-manifest.json`, filters `/_*` and data-less routes, names screenshots (`/` → `home.png`, slashes → `--`), and per route: blocks non-local requests, navigates, stabilizes the page (fonts via `document.fonts.load`, video posters, eager images, incremental scroll, image decode with hard failure on broken images, re-settle fonts, scroll to top, two rAF ticks), then `toHaveScreenshot({ fullPage: true })` |
| `tests/visual/visual-summary-reporter.ts` |   101 | Custom Playwright reporter writing `test-results/visual-changes.json` (changed routes + viewports) and `visual-summary.md`                                                                                                                                                                                                                                                                                                                |
| `scripts/run-visual.mjs`                  |    55 | In CI: build then run Playwright. Locally: run the same steps inside the pinned `mcr.microsoft.com/playwright` Docker image so Linux font rasterization matches CI; refuses to run host-only unless forced                                                                                                                                                                                                                                |
| `.github/workflows/visual-baseline.yml`   |    39 | On push to main, in the pinned container: `--update-snapshots`, upload `tests/visual/__screenshots__/` as artifact `visual-baseline-screenshots` (90-day retention)                                                                                                                                                                                                                                                                       |
| `.github/workflows/visual-regression.yml` |   216 | On PR, in the pinned container: download the **latest successful** main baseline artifact (fall back to committed screenshots), run the comparison with `continue-on-error` (always advisory), upload the Playwright HTML report, and create/update a sticky PR comment listing changed routes and viewports with Amplify preview links and the report artifact link                                                                      |

Baseline model: screenshots are **committed to the consumer repo** as a bootstrap, and PR runs
overlay the latest successful main-branch artifact when one exists. Comparisons are always
advisory; only genuine run failures (build errors, broken images) fail red via the spec throwing.

Everything in this table is kept. Nothing else is added.

## 3. What the toolkit repository contains after the rewrite

```text
BrandonMathis/visual-regression-toolkit
├── src/
│   ├── config.ts        # createVisualConfig(options) → Playwright config (from playwright.config.ts)
│   ├── pages.spec.ts    # the visual spec, reading options from the config (from pages.visual.spec.ts)
│   ├── reporter.ts      # summary reporter (verbatim)
│   └── run-visual.mjs   # bin entry (verbatim, image tag from one shared constant)
├── .github/workflows/
│   ├── ci.yml               # lint/typecheck/format + one smoke run against the fixture
│   ├── visual-baseline.yml  # reusable (workflow_call) version of the original
│   └── visual-regression.yml# reusable (workflow_call) version of the original
├── tests/fixture/       # tiny Next.js app; one smoke test that the whole loop works
├── package.json         # deps: @playwright/test only; prepare script builds dist/
└── README.md            # one page: install, configure, adopt, update baselines
```

Deleted from the current implementation: `src/baseline/`, `src/result/`, `src/reporters/`,
`src/cli/`, `src/discovery/` (folded into the spec, as in the original), `src/config/` (zod
validation, contract hashing), `src/errors.ts`, `src/runtime.ts`, `src/paths.ts`, both JSON
schemas, `release.yml`, all ajv/zod/commander/jiti/pixelmatch/pngjs dependencies, and the entire
unit/integration test tree. Playwright's built-in screenshot comparison replaces pixelmatch.

### Consumer surface (per website)

```text
consumer repository
├── playwright.visual.config.ts     # ~10 lines: createVisualConfig({ ...site options })
├── tests/visual/__screenshots__/   # committed baselines (as today in workshop-website)
├── package.json                    # devDep github:BrandonMathis/visual-regression-toolkit
│                                   # scripts: "test:visual": "run-visual",
│                                   #          "test:visual:update": "run-visual --update"
└── .github/workflows/
    ├── visual-baseline.yml         # ~10-line workflow_call caller
    └── visual-regression.yml       # ~15-line workflow_call caller
```

### The only configuration options

Parameterize exactly what differs between the two sites — nothing speculative:

```ts
createVisualConfig({
  fonts: ['400 16px Manrope', '600 48px "Bricolage Grotesque"'], // document.fonts.load strings
  colorScheme: 'dark', // workshop-website is dark; default 'dark'
  port: 3000, // baseURL/webServer port; default 3000
  startCommand: 'npm run start -- --hostname 127.0.0.1', // default as shown
  exclude: [], // optional route prefixes to skip
});
```

If the second site needs another knob during adoption, add it then — not before. There is no
validation layer: a wrong option surfaces as a failed Playwright run, which is acceptable
internally.

### Distribution (unchanged from the current repo)

- Install from GitHub: `npm install --save-dev github:BrandonMathis/visual-regression-toolkit`
  (the `prepare` script builds on install). Consumers track `main`.
- Reference the reusable workflows at `@main`.
- No npm publishing. Git tags optional, only if a fixed ref is ever wanted.
- The Playwright version and container image tag are pinned in one place in the toolkit and
  referenced everywhere (package dependency, run-visual.mjs, both workflows). Bumping Playwright
  means one commit here plus refreshed baselines in each site.

## 4. Reusable workflow behavior (faithful to the originals)

`visual-baseline.yml` (workflow_call): checkout, setup-node with npm cache, `npm ci`,
`run-visual --update`, upload `tests/visual/__screenshots__/` as `visual-baseline-screenshots`
with 90-day retention. Runs in the pinned Playwright container.

`visual-regression.yml` (workflow_call): checkout, `npm ci`, look up the **latest successful**
main-branch baseline run and download its artifact over the committed screenshots (silently fall
back to committed screenshots when absent — bootstrap path), run `run-visual` with
`continue-on-error`, always upload the Playwright HTML report, and create/update the sticky
PR comment (marker `<!-- visual-regression-report -->`) listing changed route/viewport pairs as a
manual-testing checklist, with preview links and the report artifact URL. Inputs:
`preview-app-domain` (optional, replaces the hard-coded Amplify variable) and `node-version`
(default 24).

Accepted simplifications, stated once so nobody re-adds the machinery later:

- **Latest main baseline, not exact base-SHA.** A PR racing a just-merged visual change may show a
  stale comparison. With two low-traffic internal sites and advisory-only diffs, re-running the
  job after main settles is the fix.
- **No artifact verification.** Artifacts are produced and consumed by our own workflows in our
  own repos; corruption or tampering is out of scope.
- **No version-coupling checks.** Package and workflows both track `main` and move together.
- **`pull-requests: write` on the PR job.** Required for the sticky comment; fine internally.
- **Actions referenced by version tags** (`actions/checkout@v7` style), as in the originals — not
  SHA-pinned.
- **Advisory means advisory.** Visual diffs never block; only real run failures (build failure,
  broken images, unreachable server) fail the check, because the spec throws before capture.

## 5. Migration steps

1. **Rewrite this repository in place** (git history and an optional pre-rewrite tag preserve the
   heavyweight version): delete the code listed in §3, port the four workshop-website files into
   `src/` with the options from §3 replacing hard-coded values (font list, color scheme, port,
   Amplify domain), and convert the two workflows to `workflow_call` with the two inputs.
2. **Prove the loop on the fixture**: keep a minimal Next.js fixture and one CI smoke job that
   generates baselines, reruns unchanged (green), then makes a CSS change and confirms the run
   reports a diff and writes `visual-changes.json`. This is the only test suite.
3. **Migrate workshop-website**: replace its copied files with the toolkit dependency and thin
   callers; its committed `tests/visual/__screenshots__/` stay exactly where they are. The visual
   output must be identical — same screenshot names, same baseline paths, same PR comment format —
   so no baselines need regenerating. This adoption PR is the real acceptance test.
4. **Adopt the second site**: install, add config with its own fonts/options, generate and commit
   its baselines, add the two callers.

## 6. Definition of done

- The toolkit repo holds the four migrated source files, two reusable workflows, a fixture smoke
  test, and a one-page README — no manifests, hashes, schemas, CLIs, error-code registries, or
  validation layers anywhere.
- workshop-website consumes the toolkit with zero copied visual-test logic and unchanged committed
  baselines, and its PR comment behavior is indistinguishable from before the migration.
- The second site adopts with only: the dependency, a ~10-line config, two thin callers, and its
  committed baselines.
- Total toolkit line count (src + workflows + fixture test + README) is under ~1,000 lines.
