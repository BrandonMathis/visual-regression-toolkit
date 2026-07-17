# Architecture

## Responsibility split

Three parties own strictly separated concerns.

### Package (`@thisdot/visual-regression`)

- Load, validate, normalize, and hash configuration.
- Build and start the consumer application.
- Discover supported routes from `.next/prerender-manifest.json`.
- Generate an internal Playwright configuration and tests — never reading, replacing, or merging
  with a consumer's functional Playwright setup.
- Stabilize pages and capture screenshots.
- Create and verify baseline manifests.
- Compare candidates against a verified baseline.
- Classify results and write reports.
- Expose stable CLI commands and exit codes.

### Reusable workflows (this repository's `.github/workflows/`)

- Check out the caller repository safely (persisted credentials disabled).
- Verify the consumer's exact toolkit version before anything else runs.
- Install dependencies without secrets.
- Run in the pinned Playwright container.
- Publish complete baseline artifacts.
- Resolve a baseline for the exact pull-request base SHA.
- Verify downloaded baseline content.
- Preserve and classify CLI outcomes.
- Upload reports, results, traces, and diagnostics.
- Write a clear GitHub job summary.

### Consumer repository

- Declare application build/start behavior and visual settings in
  `visual-regression.config.ts`.
- Pin the package to the version paired with the workflow release.
- Keep visual builds deterministic and free of production credentials or side effects.
- Declare intentional route exclusions, masks, readiness selectors, font probes, and
  external-request allowances.
- Review baseline and diff artifacts.

## Determinism model

Two captures of the same commit under the same contract must be byte-identical. For every
route/project pair the generated suite:

1. Starts from a clean browser context with the configured locale, timezone, color scheme,
   viewport, and reduced motion.
2. Blocks service workers and non-allowed browser requests by default.
3. Navigates with `waitUntil: 'domcontentloaded'` and requires a successful response.
4. Waits for configured readiness selectors.
5. Awaits `document.fonts.ready` and each configured font probe.
6. Disables animations and hides carets.
7. Sets lazy images to eager where safe.
8. Scrolls incrementally through the complete page to trigger lazy rendering.
9. Decodes images and reports required broken or incomplete resources.
10. Stabilizes videos with posters or a deterministic frame when supported.
11. Returns to the top and waits for two animation frames.
12. Rechecks fonts and required resources after lazy content is revealed.
13. Captures one full-page screenshot.

All waits have bounded timeouts with route and resource context in error messages. Navigation,
resource, build, server, and timeout failures are infrastructure errors — never visual
differences. Time itself is pinned: one logical date is injected into the configured clock
environment variable for build, start, and capture, and comparison runs reuse the baseline's
logical date. The browser and OS are pinned by the release coupling ([release.md](release.md)).

## Baseline identity

A baseline is compatible only when all of these match:

```text
consumer repository
+ exact base source SHA
+ visual-contract hash
+ toolkit major/schema
+ exact Playwright and Chromium identity
+ container digest/platform
```

A missing, extra, altered, cross-repository, wrong-SHA, wrong-config, or wrong-runtime file
invalidates the baseline. The manifest (`baseline-manifest.json`) records all identity fields plus
each screenshot's relative path, dimensions, byte size, and SHA-256 checksum; verification runs
after artifact download and again immediately before comparison.

The visual-contract hash covers every setting that can alter pixels or comparison semantics
(projects, locale/timezone/color-scheme/motion, font checks, readiness selectors, masks,
external-request policy, screenshot options and thresholds, stabilization and adapter behavior
versions). It excludes discovered routes — so added and removed pages surface as visual
differences, not incompatibilities — and excludes source SHA, timestamps, output directories, and
report preferences. Equivalent normalized configurations hash identically.

## Result contract

Every operation writes a bounded, schema-validated `visual-result.json` with an operation of
`baseline-create` or `compare`.

| Status                 | Exit | Meaning                                                                                              |
| ---------------------- | ---: | ---------------------------------------------------------------------------------------------------- |
| `pass`                 |  `0` | `baseline-create` produced a complete verified baseline, or `compare` completed with no differences. |
| `infrastructure-error` |  `1` | The requested operation could not complete or cannot be trusted.                                     |
| `visual-diff`          |  `2` | A complete, verified `compare` found changed, added, or removed route/project screenshots.           |

`visual-diff` is valid only for `compare`. Exit `2` must never represent an incomplete comparison,
missing baseline, or setup failure. A successful `baseline-create` means the artifact content is
ready to publish; the workflow reports successful publication only after the immutable artifact
upload itself succeeds.

The result includes: operation and status; baseline and candidate full SHAs; visual-contract and
runtime identity; route and screenshot totals; changed, added, and removed route/project pairs;
relative expected, actual, and diff paths; stable bounded error codes and messages; a retryable
flag; and relative report paths.

Fixed output layout (relative to the consumer repo root, cleared before each operation):

```text
.visual-regression/
├── candidate/
├── baseline/
└── result/
    ├── visual-result.json
    └── visual-summary.md
playwright-report/visual/
test-results/visual/
```

The workflow may translate a schema-valid exit `2` to a successful advisory conclusion only after
verifying the result operation, candidate SHA, baseline identity, and artifact completeness. Exit
`1` always fails.

## Workflow security model

Any job that installs dependencies, loads consumer config, builds the application, starts the
server, or runs the browser is treated as executing untrusted code and must:

- use `contents: read` and only the minimum `actions: read` needed for baseline retrieval;
- use `actions/checkout` with persisted credentials disabled;
- receive no repository, organization, deployment, or PR-write secrets;
- never use `secrets: inherit`;
- never run PR code under `pull_request_target`;
- use the public tokenless toolkit package;
- clear result directories before execution;
- invoke the exact toolkit CLI directly rather than a PR-editable consumer script; and
- upload fixed, documented artifact paths with size limits.

Version 1 does not post PR comments, so no privileged reporting job exists. If comments are added
later, they must run in a separate job that does not check out or execute consumer code and that
validates, bounds, and escapes the fixed result artifact before receiving `pull-requests: write`.

Controls on this repository itself: protected `main` and immutable release tags, CODEOWNERS review
for workflows/schemas/releases, all third-party actions pinned to reviewed full commit SHAs, and
dependency review plus `actionlint` and `zizmor` in CI. The package is consumed directly from this
GitHub repository (no npm registry, no publish credentials anywhere); tags, when created, are
never rewritten.
