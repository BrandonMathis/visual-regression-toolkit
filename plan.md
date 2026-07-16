# Shared Visual Regression Toolkit: Final Implementation Plan

## 1. Goal

Create one shared repository that provides a reusable visual-regression toolchain for multiple website repositories.

The shared repository will publish:

1. `@thisdot/visual-regression`, an exact-versioned TypeScript package and CLI that owns configuration, Next.js route discovery, browser orchestration, screenshot capture, baseline validation, comparison, and reporting.
2. Two reusable GitHub Actions workflows that publish authoritative baselines and compare pull requests against the exact baseline for their base commit.

A consumer repository should contain only:

- one declarative configuration file;
- one exact package dependency;
- optional local convenience scripts;
- two thin reusable-workflow callers; and
- no copied Playwright visual spec, reporter, Docker runner, or baseline orchestration.

The first release favors a small, reliable CI workflow over a broad visual-testing platform.

## 2. Version 1 scope

### Included

- Next.js routes from `.next/prerender-manifest.json`.
- Chromium only.
- Desktop, tablet, and phone projects.
- Full-page screenshots.
- Generated Playwright configuration isolated from functional E2E tests.
- Production build and server lifecycle management.
- Deterministic handling of fonts, images, lazy content, media, animations, carets, and external browser requests.
- Artifact-backed baselines stored in each consumer repository.
- Exact pull-request base-SHA baseline lookup.
- A verified baseline manifest with compatibility metadata and image checksums.
- Three result states: pass, visual difference, and infrastructure error.
- Advisory visual differences by default; infrastructure errors always fail.
- Machine-readable JSON, Markdown/job summaries, Playwright HTML reports, and diff artifacts.
- A fixture Next.js application proving the complete lifecycle.

### Deferred

- Cross-browser testing.
- Framework adapters other than Next.js prerender discovery.
- Component-level and authenticated-page testing.
- Hosted dashboards or approval services.
- Preview-environment links.
- Sticky PR comments. Version 1 uses GitHub job summaries and downloadable artifacts.
- Local Docker orchestration and authoritative local baseline generation. CI is authoritative; host execution is diagnostic only.
- Arbitrary executable capture hooks.
- Independently released protocol packages or multiple protocol version axes.
- SBOM generation, external canary repositories, and rollback rehearsals.
- A custom GitHub Action in addition to the package and reusable workflows.

Deferred features must not become version 1 release gates.

## 3. Decisions fixed for version 1

1. **Repository:** `thisdot/visual-regression-toolkit`.
2. **Package:** `@thisdot/visual-regression`.
3. **Registry:** publish version 1 to public npm so PR installation is tokenless. If organization policy forbids public publication, stop before Phase 1 and approve a separate private-distribution and fork-PR design; do not quietly add package credentials to this workflow.
4. **Runtime:** Node.js 22.
5. **Browser:** one exact Playwright release and its bundled Chromium revision.
6. **Platform:** the matching Playwright Linux container, pinned by immutable digest and run as `linux/amd64`.
7. **Baselines:** immutable GitHub Actions artifacts in the consumer repository, retained for 90 days.
8. **Workflow topology:** separate reusable baseline and pull-request comparison workflows.
9. **Enforcement:** visual differences are advisory by default; infrastructure errors are always blocking.
10. **PR reporting:** job summaries and artifacts only in version 1.
11. **Release coupling:** one toolkit release binds the exact package version, workflow commit, Playwright version, Chromium revision, container digest, and baseline/result schema versions.
12. **Config-changing PRs:** a changed visual-contract hash cannot use the existing baseline. The comparison returns an infrastructure error with `VISUAL_CONTRACT_CHANGED`. The reviewed rollout is to merge with an explicit check waiver, publish a baseline from the resulting default-branch commit, and then resume normal comparisons. Version 1 will not synthesize an ephemeral baseline for a new contract.

## 4. Ownership and architecture

```text
consumer repository
├── visual-regression.config.ts
├── package.json                         # exact package version
└── .github/workflows/
    ├── visual-baseline.yml              # thin reusable-workflow caller
    └── visual-regression.yml            # thin reusable-workflow caller
             │
             ▼
thisdot/visual-regression-toolkit
├── src/
│   ├── cli/
│   ├── config/
│   ├── discovery/
│   ├── capture/
│   ├── baseline/
│   ├── result/
│   └── reporters/
├── schemas/
│   ├── baseline-manifest.schema.json
│   └── visual-result.schema.json
├── tests/
│   ├── fixtures/next-app/
│   ├── unit/
│   └── integration/
├── .github/workflows/
│   ├── ci.yml
│   ├── visual-baseline.yml              # reusable workflow_call workflow
│   ├── visual-regression.yml            # reusable workflow_call workflow
│   └── release.yml
├── docs/
├── package.json
└── README.md
```

### Package responsibilities

- Load, validate, normalize, and hash configuration.
- Build and start the consumer application.
- Discover supported routes.
- Generate an internal Playwright configuration and tests.
- Stabilize pages and capture screenshots.
- Create and verify baseline manifests.
- Compare candidates against a verified baseline.
- Classify results and write reports.
- Expose stable CLI commands and exit codes.

### Reusable workflow responsibilities

- Check out the caller repository safely.
- Verify the consumer's exact toolkit version.
- Install dependencies without secrets.
- Run in the pinned Playwright container.
- Publish complete baseline artifacts.
- Resolve a baseline for the exact pull-request base SHA.
- Verify downloaded baseline content.
- Preserve and classify CLI outcomes.
- Upload reports, results, traces, and diagnostics.
- Write a clear GitHub job summary.

### Consumer responsibilities

- Declare application build/start behavior and visual settings.
- Pin the package to the version paired with the workflow release.
- Keep visual builds deterministic and free of production credentials or side effects.
- Declare intentional route exclusions, masks, readiness selectors, font probes, and external-request allowances.
- Review baseline and diff artifacts.

## 5. Public package contract

### 5.1 TypeScript API

Keep public exports small:

```ts
export {
  defineVisualConfig,
  type VisualRegressionConfig,
  type VisualResult,
  type VisualResultStatus,
} from '@thisdot/visual-regression';
```

Playwright fixtures, generated tests, reporters, manifest helpers, and workflow internals remain private.

### 5.2 Configuration

Example:

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

Default projects:

```ts
[
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024, hasTouch: true },
  { name: 'phone', width: 375, height: 812, hasTouch: true, isMobile: true },
];
```

Validation must:

- reject unknown fields;
- reject invalid selectors, origins, project names, globs, and unsafe paths;
- resolve paths relative to the consumer repository root;
- reject duplicate project names;
- require a loopback server origin in version 1;
- normalize order-independent values before hashing;
- avoid logging environment values;
- reject unresolved dynamic route parameters; and
- fail rather than permit an empty route set.

### 5.3 Visual-contract hash

The normalized hash includes every setting that can alter pixels or comparison semantics:

- projects and viewport/device capabilities;
- locale, timezone, color scheme, and reduced-motion setting;
- font checks and readiness selectors;
- masks;
- external-request policy;
- screenshot options and thresholds;
- stabilization behavior version;
- adapter behavior version; and
- relevant output-affecting defaults.

The hash excludes:

- discovered routes, so added and removed pages become visual differences;
- source SHA;
- creation timestamps and logical date;
- output directories; and
- report-opening preferences.

Equivalent normalized configurations must produce the same hash. Any intentional visual-contract change produces a different hash and follows the config-change policy in Section 3.

### 5.4 CLI

Version 1 commands:

| Command                                      | Purpose                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `visual-regression baseline create`          | Build, start, discover, capture, create a complete manifest, and verify it.                             |
| `visual-regression baseline verify <dir>`    | Validate manifest identity, compatibility, paths, dimensions, and checksums.                            |
| `visual-regression compare --baseline <dir>` | Build and capture a candidate, verify the baseline, compare all route/project pairs, and write results. |
| `visual-regression report`                   | Print or open the latest HTML report.                                                                   |

All commands support structured logging and a JSON-output mode where needed by workflows. Logs go to stderr when stdout is reserved for JSON.

Host execution is available only through an explicit `--host` diagnostic flag and must warn that host screenshots are not authoritative or CI-comparable.

## 6. Route discovery and naming

The Next.js adapter must:

1. Read `.next/prerender-manifest.json` only after a successful production build.
2. Support explicitly tested manifest shapes and fail closed on unknown shapes.
3. Select actual prerendered HTML routes.
4. Exclude internal routes beginning with `/_` and metadata/non-page entries.
5. Apply configured include and exclude globs.
6. Add explicit additional routes.
7. Sort and deduplicate routes.
8. Reject unresolved parameter routes.
9. Preserve original route values in all results.
10. Fail if no routes remain.

Screenshot names must:

- map `/` to `home.png`;
- be portable across filesystems;
- reject traversal and absolute paths;
- safely encode Unicode and reserved characters; and
- detect collisions before browser execution begins.

Baseline layout:

```text
baseline/
├── baseline-manifest.json
└── screenshots/
    ├── desktop/
    ├── tablet/
    └── phone/
```

## 7. Deterministic capture behavior

For every route/project pair, the generated suite must:

1. Start from a clean browser context with the configured locale, timezone, color scheme, viewport, and reduced motion.
2. Block service workers and non-allowed browser requests by default.
3. Navigate with `waitUntil: 'domcontentloaded'` and require a successful response.
4. Wait for configured readiness selectors.
5. Await `document.fonts.ready` and each configured font probe.
6. Disable animations and hide carets.
7. Set lazy images to eager where safe.
8. Scroll incrementally through the complete page to trigger lazy rendering.
9. Decode images and report required broken or incomplete resources.
10. Stabilize videos with posters or a deterministic frame when supported.
11. Return to the top and wait for two animation frames.
12. Recheck fonts and required resources after lazy content is revealed.
13. Capture one full-page screenshot.

All waits require bounded timeouts with route and resource context in error messages. Navigation, resource, build, server, and timeout failures are infrastructure errors, never visual differences.

The package must generate and use its own temporary Playwright configuration and tests. It must not read, replace, or merge with a consumer's functional Playwright configuration.

## 8. Baseline manifest and identity

### 8.1 Manifest contents

`baseline-manifest.json` records:

- schema version tied to the toolkit major;
- consumer repository identity;
- base branch;
- full source commit SHA;
- workflow run ID and attempt;
- UTC creation time;
- one logical date used for baseline build and capture;
- exact toolkit and Playwright versions;
- Chromium revision;
- operating system, architecture, container digest, and platform;
- normalized visual-contract hash;
- adapter identity;
- project descriptors;
- route descriptors; and
- each screenshot's relative path, dimensions, byte size, and SHA-256 checksum.

Artifact names are lookup aids only. Full verified manifest values are authoritative.

Suggested artifact name:

```text
visual-baseline-<sha12>-<config12>-<run-id>-<attempt>
```

### 8.2 Publication rules

1. Resolve the full source SHA and one logical date at job start.
2. Inject the logical date into the configured clock environment variable for build, start, and capture.
3. Build, discover, and capture every required route/project pair.
4. Write the manifest only after every capture succeeds.
5. Verify the manifest and checksums in a separate process.
6. Upload manifest and screenshots as one immutable artifact.
7. Never publish a partial baseline.

### 8.3 Compatibility identity

A baseline is compatible only when all of these match:

```text
consumer repository
+ exact base source SHA
+ visual-contract hash
+ toolkit major/schema
+ exact Playwright and Chromium identity
+ container digest/platform
```

A missing, extra, altered, cross-repository, wrong-SHA, wrong-config, or wrong-runtime file invalidates the baseline.

## 9. Exact baseline retrieval

For a pull request, the reusable comparison workflow must:

1. Read `github.event.pull_request.base.sha` once at job start.
2. Compute the candidate's normalized visual-contract hash using the workflow-paired package version.
3. List successful baseline workflow runs for the exact base SHA.
4. Inspect their verified manifests. If an otherwise compatible base-SHA baseline exists but its visual-contract hash differs, return `VISUAL_CONTRACT_CHANGED` rather than `BASELINE_NOT_FOUND`.
5. Find artifacts whose verified manifests match the complete compatibility identity.
6. Select deterministically by highest successful workflow run ID, then highest run attempt.
7. If no valid artifact exists but publication for that exact SHA is active, wait for up to 10 minutes.
8. Download the selected artifact outside generated result directories.
9. Verify its manifest and every checksum after download and immediately before comparison.
10. Inject the baseline manifest's logical date into the configured clock environment variable for candidate build, start, and capture.
11. Compare only after verification succeeds.

Never fall back to:

- committed screenshots;
- the latest baseline regardless of SHA;
- an ancestor or newer default-branch commit;
- another repository;
- a different config hash; or
- a different browser/container identity.

Missing, expired, corrupt, incompatible, or timed-out baselines are infrastructure errors with stable error codes.

## 10. Result contract

Every operation writes a bounded, schema-validated `visual-result.json` with an operation of `baseline-create` or `compare`.

### Status and exit codes

| Status                 | Exit | Meaning                                                                                              |
| ---------------------- | ---: | ---------------------------------------------------------------------------------------------------- |
| `pass`                 |  `0` | `baseline-create` produced a complete verified baseline, or `compare` completed with no differences. |
| `infrastructure-error` |  `1` | The requested operation could not complete or cannot be trusted.                                     |
| `visual-diff`          |  `2` | A complete, verified `compare` found changed, added, or removed route/project screenshots.           |

`visual-diff` is valid only for `compare`. Exit `2` must never represent an incomplete comparison, missing baseline, or setup failure. A successful `baseline-create` means the artifact content is ready to publish; the workflow reports successful baseline publication only after the immutable artifact upload itself succeeds.

The result includes:

- operation and status;
- baseline and candidate full SHAs;
- visual-contract and runtime identity;
- route and screenshot totals;
- changed, added, and removed route/project pairs;
- relative expected, actual, and diff paths;
- stable bounded error codes and messages;
- retryable flag; and
- relative report paths.

Output paths:

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

The workflow may translate a schema-valid exit `2` to a successful advisory conclusion after verifying the result operation, candidate SHA, baseline identity, and artifact completeness. Exit `1` always fails.

## 11. Workflow security model

### Untrusted baseline/comparison execution

Any job that installs dependencies, loads consumer config, builds the application, starts the server, or runs the browser must:

- use `contents: read` and only the minimum `actions: read` needed for baseline retrieval;
- use `actions/checkout` with persisted credentials disabled;
- receive no repository, organization, deployment, or PR-write secrets;
- never use `secrets: inherit`;
- use no `pull_request_target` execution of PR code;
- use the public tokenless toolkit package;
- clear result directories before execution;
- invoke the exact toolkit CLI directly rather than a PR-editable consumer script; and
- upload fixed, documented artifact paths with size limits.

Version 1 does not post PR comments, so no privileged reporting job is required. If comments are added later, they must use a separate job that does not check out or execute consumer code and that validates, bounds, and escapes the fixed result artifact before receiving `pull-requests: write`.

### Shared repository controls

- Protect `main` and immutable release tags.
- Require CODEOWNERS review for workflows, schemas, and releases.
- Pin all third-party actions to reviewed full commit SHAs.
- Run dependency review, `actionlint`, and `zizmor`.
- Publish package provenance through trusted publishing/OIDC.
- Do not rewrite package versions or release tags.

## 12. Package and workflow release coupling

Each toolkit release records:

- exact npm package version;
- immutable reusable-workflow commit SHA;
- Node major;
- exact Playwright version;
- Chromium revision;
- container image digest/platform; and
- manifest/result schema versions.

Consumers must:

- install with `--save-exact`;
- commit the lockfile; and
- reference reusable workflows by full commit SHA.

The reusable workflow embeds its expected package version. Before evaluating configuration or running screenshots, it verifies the consumer manifest and lockfile resolve exactly that version. Mismatches fail with `TOOLKIT_VERSION_MISMATCH`.

A Playwright, Chromium, container, stabilization-default, or other pixel-affecting release change requires a coordinated toolkit release and new consumer baselines.

## 13. Implementation phases

### Phase 1: Establish repository and contracts

**Work**

- Create the repository, branch protection, CODEOWNERS, security policy, and dependency automation.
- Scaffold an ESM TypeScript package for Node 22 with declarations and one CLI binary.
- Pin Playwright and the authoritative container digest/platform.
- Define strict TypeScript types and JSON Schemas for configuration, baseline manifests, and results.
- Define stable error codes and the three exit codes.
- Add format, lint, typecheck, unit-test, build, and package-content checks.

**Acceptance**

- A clean clone passes all package checks.
- `npm pack --dry-run` contains only intended files.
- Valid schemas round-trip; unknown and malformed fields fail clearly.
- CLI help runs from a packed tarball installed in a temporary project.

### Phase 2: Prove a vertical slice

**Work**

- Create a minimal Next.js fixture.
- Load and normalize configuration.
- Run the configured production build and server with readiness checks and reliable cleanup.
- Read the prerender manifest and discover `/`.
- Generate an isolated Playwright suite.
- Capture one Chromium screenshot in the pinned container.

**Acceptance**

- The fixture produces `home.png` without consumer-owned Playwright visual files.
- Server failures, readiness timeouts, and signals clean up child processes.
- Existing functional Playwright configuration remains untouched.

### Phase 3: Complete route discovery and deterministic capture

**Work**

- Implement all route filtering, additional routes, sorting, parameter rejection, and filename safety.
- Add the three default projects and project overrides.
- Implement network, font, lazy-image, media, animation, caret, mask, and readiness behavior.
- Add bounded resource diagnostics.
- Generate expected, actual, diff, trace, and HTML report output in isolated directories.

**Acceptance**

- Fixtures cover static and generated routes, exclusions, malformed manifests, Unicode, collisions, and empty route sets.
- Fixtures cover lazy images, broken images, fonts, animations, videos, external requests, masks, and long pages.
- Two clean fixture captures in the pinned container are byte-identical.

### Phase 4: Implement baseline and result contracts

**Work**

- Implement visual-contract hashing.
- Implement manifest creation and checksum verification.
- Implement baseline compatibility checks.
- Implement complete comparison, including changed, added, and removed screenshots.
- Generate JSON, Markdown, and HTML outputs.
- Enforce the three statuses and exit codes.

**Acceptance**

- Missing, altered, extra, wrong-repository, wrong-SHA, wrong-config, and wrong-runtime baselines are rejected.
- Golden tests prove `baseline-create` pass/`0` and all three `compare` outcomes: pass/`0`, infrastructure-error/`1`, and visual-diff/`2`.
- Added and removed routes are visual differences.
- Config-changing PR behavior produces `VISUAL_CONTRACT_CHANGED`.

### Phase 5: Implement reusable workflows

**Work**

- Build `visual-baseline.yml` with push, schedule, and manual caller support.
- Build `visual-regression.yml` for pull-request comparison.
- Add exact-base-SHA lookup, deterministic artifact selection, and bounded waiting.
- Verify package/workflow/runtime coupling before execution.
- Reuse the baseline manifest's logical date for candidate build, start, and capture.
- Run screenshot work in the pinned container.
- Preserve exit status while always uploading reports and diagnostics.
- Convert only validated visual differences to advisory success.
- Write concise GitHub job summaries.
- Add timeouts and concurrency keyed so newer pushes cannot cancel baseline publication needed by an open PR.

**Acceptance**

- A newer or older baseline for another SHA is never selected.
- Missing, expired, active-but-timed-out, corrupt, and incompatible baselines fail distinctly.
- Visual differences remain advisory by default and retain complete evidence.
- Build and infrastructure failures remain red.
- No job executing consumer code receives secrets or write permission.

### Phase 6: Complete fixture and workflow validation

**Work**

- Expand the fixture app to cover all supported capture behavior.
- Test baseline publication and exact retrieval with fixture-driven GitHub API scripts.
- Test malformed and oversized result payload rejection.
- Validate workflow YAML and pinned actions with `actionlint` and `zizmor`.
- Test package tarball installation and exact-version mismatch behavior.

**Acceptance**

- Repository-local tests prove baseline publication, unchanged comparison, deliberate pixel change, added/removed routes, all infrastructure failures, exact-SHA rejection, logical-date reuse, and malformed untrusted output handling.
- No high-severity workflow-security finding remains.

### Phase 7: Document, release, and independently review

**Work**

- Document configuration, CLI commands, workflow inputs, artifacts, result codes, and baseline lifecycle.
- Document initial seeding, artifact expiry, config-changing PR rollout, upgrades, rollback, and intentional visual changes.
- Publish an immutable release with package version and workflow SHA recorded together.
- Conduct focused reviews of baseline correctness, workflow security, and screenshot determinism.

**Acceptance**

- A clean consumer can adopt the toolkit using only the installation guide.
- No blocker or high-severity review finding remains.
- The released package/workflow pair passes the complete fixture lifecycle.

## 14. Validation matrix

| Scenario                                   | CLI result                      | Workflow behavior                                            |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------ |
| Complete baseline creation and publication | `baseline-create`: `pass` / `0` | Green only after immutable verified artifact upload succeeds |
| Unchanged candidate                        | `pass` / `0`                    | Green                                                        |
| Pixel difference                           | `visual-diff` / `2`             | Advisory green; warning summary and report                   |
| Added or removed route                     | `visual-diff` / `2`             | Advisory green; route/project details                        |
| Build or server failure                    | `infrastructure-error` / `1`    | Red with stable error code                                   |
| Resource or capture timeout                | `infrastructure-error` / `1`    | Red with route/resource context                              |
| Missing exact baseline                     | `infrastructure-error` / `1`    | `BASELINE_NOT_FOUND`                                         |
| Active baseline exceeds wait               | `infrastructure-error` / `1`    | `BASELINE_NOT_READY`                                         |
| Corrupt manifest or screenshot             | `infrastructure-error` / `1`    | `BASELINE_CORRUPT`                                           |
| Wrong SHA/config/runtime                   | `infrastructure-error` / `1`    | `BASELINE_INCOMPATIBLE`                                      |
| Changed visual contract                    | `infrastructure-error` / `1`    | `VISUAL_CONTRACT_CHANGED` with rollout instructions          |
| Package/workflow mismatch                  | `infrastructure-error` / `1`    | `TOOLKIT_VERSION_MISMATCH` before capture                    |
| Newer baseline for another SHA             | N/A                             | Exact artifact selected; wrong artifact ignored              |
| Malformed/oversized result                 | Rejected                        | Workflow fails; no advisory conversion                       |
| Host execution                             | Diagnostic only                 | Never publishes an authoritative baseline                    |

Required repository checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
npm pack --dry-run
actionlint
zizmor .github/workflows
```

## 15. Consumer installation guide

### 15.1 Install the exact package

```bash
npm install --save-dev --save-exact @thisdot/visual-regression@1.0.0
```

Commit `package.json` and the lockfile. Use the exact version paired with the selected workflow commit.

### 15.2 Add configuration

Create `visual-regression.config.ts` using the configuration contract in Section 5. Keep production credentials out of the file and visual workflows. Use harmless test values and disable external side effects.

### 15.3 Ignore generated output

```gitignore
/.visual-regression/
/playwright-report/visual/
/test-results/visual/
```

Baselines used by CI are artifacts, not committed screenshots.

### 15.4 Add the baseline caller

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
    uses: thisdot/visual-regression-toolkit/.github/workflows/visual-baseline.yml@FULL_RELEASE_COMMIT_SHA
    with:
      config-path: visual-regression.config.ts
      node-version: '22'
      retention-days: 90
```

The monthly schedule refreshes artifacts in repositories without recent default-branch changes.

### 15.5 Add the comparison caller

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
    uses: thisdot/visual-regression-toolkit/.github/workflows/visual-regression.yml@FULL_RELEASE_COMMIT_SHA
    with:
      config-path: visual-regression.config.ts
      baseline-workflow-file: visual-baseline.yml
      node-version: '22'
      visual-diffs-are-informational: true
```

Do not add `secrets: inherit`. Replace `FULL_RELEASE_COMMIT_SHA` with the immutable SHA documented by the toolkit release.

### 15.6 Seed and verify

1. Merge the configuration and callers to the default branch.
2. Allow the push workflow, or a manual baseline run, to publish the first exact-SHA baseline.
3. Confirm the artifact contains `baseline-manifest.json` and all expected screenshots.
4. Open a no-change PR and confirm a clean comparison.
5. Add a temporary CSS change and confirm a `visual-diff`, report, and advisory workflow conclusion.
6. Trigger a temporary build failure and confirm an infrastructure error remains blocking.
7. Revert the temporary changes.

Do not make comparison a required check until the initial baseline exists.

### 15.7 Operate and upgrade

- Publish a baseline on every default-branch push, monthly schedule, and manual request.
- Review the GitHub summary and download the HTML report for differences.
- Upgrade the exact package version and workflow SHA together.
- Regenerate baselines after any browser, container, default, or visual-contract change.
- For a config-changing PR, use the documented explicit waiver, merge it, and wait for the resulting default-branch baseline before normal PR comparisons resume.
- Roll back by restoring both the previous exact package version and workflow SHA, then publishing a compatible baseline.

## 16. Definition of done

Version 1 is complete when:

- generic visual-test logic exists only in the shared toolkit;
- a consumer adds one config file, one exact dependency, and two thin workflow callers;
- no consumer-owned visual Playwright spec or reporter is required;
- Next.js prerender routes are discovered automatically and safely;
- screenshots run in one pinned Chromium/Linux environment;
- baseline artifacts are complete, immutable, checksummed, and tied to the exact source SHA and visual contract;
- pull requests never compare against stale, newer, ancestor, committed, or incompatible screenshots;
- pass, visual difference, and infrastructure error have stable schemas and exit codes;
- advisory mode cannot hide infrastructure failures;
- consumer code never executes with secrets or PR-write permission;
- package, workflow, Playwright, Chromium, and container versions cannot drift;
- fixture tests prove deterministic capture and the complete baseline/comparison lifecycle;
- installation succeeds from a clean consumer repository without undocumented steps; and
- baseline-correctness, workflow-security, and screenshot-determinism reviews have no unresolved blockers.
