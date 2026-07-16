# @thisdot/visual-regression

A shared visual-regression toolkit for Next.js websites. One repository owns all of the generic
machinery — configuration loading and hashing, prerender route discovery, deterministic Chromium
capture, artifact-backed baselines, comparison, and reporting — so that a consumer repository adds
only:

- one declarative config file (`visual-regression.config.ts`);
- one exact-versioned dev dependency (`@thisdot/visual-regression`); and
- two thin GitHub Actions workflow callers.

Consumers never copy a Playwright visual spec, reporter, Docker runner, or baseline orchestration.

Version 1 is deliberately small: Next.js prerendered routes only, Chromium only, full-page
screenshots on three viewport projects (desktop, tablet, phone), baselines stored as immutable
GitHub Actions artifacts in the consumer repository, and pull-request comparison against the exact
baseline for the PR's base commit.

## Architecture

```text
consumer repository
├── visual-regression.config.ts
├── package.json                         # exact package version
└── .github/workflows/
    ├── visual-baseline.yml              # thin reusable-workflow caller
    └── visual-regression.yml            # thin reusable-workflow caller
             │
             ▼
visual-regression-toolkit (this repository)
├── src/                                 # config, discovery, capture, baseline, result, reporters, CLI
├── schemas/                             # baseline-manifest and visual-result JSON Schemas
├── .github/workflows/                   # reusable visual-baseline.yml and visual-regression.yml
└── docs/
```

The package builds and starts the consumer app, discovers prerendered routes from
`.next/prerender-manifest.json`, generates its own isolated Playwright suite (it never touches a
consumer's functional Playwright setup), stabilizes each page, captures screenshots, and creates or
compares against a checksummed baseline manifest. The reusable workflows run everything in one
pinned Playwright Linux container, publish baselines as immutable artifacts, and resolve the exact
baseline for a pull request's base SHA — never a stale, newer, ancestor, or committed screenshot.

See [docs/architecture.md](docs/architecture.md) for the full responsibility split, determinism
model, baseline identity, result contract, and security model.

## Quickstart

Full guide: [docs/installation.md](docs/installation.md).

1. Install the exact package version paired with your chosen workflow release:

   ```bash
   npm install --save-dev --save-exact @thisdot/visual-regression@1.0.0
   ```

2. Create `visual-regression.config.ts`:

   ```ts
   import { defineVisualConfig } from '@thisdot/visual-regression';

   export default defineVisualConfig({
     framework: { type: 'next-prerender' },
     commands: {
       build: 'npm run build',
       start: 'npm run start -- --hostname 127.0.0.1',
     },
     server: { origin: 'http://127.0.0.1:3000' },
   });
   ```

3. Ignore generated output:

   ```gitignore
   /.visual-regression/
   /playwright-report/visual/
   /test-results/visual/
   ```

4. Add the two workflow callers (`visual-baseline.yml` and `visual-regression.yml`) referencing
   this repository's reusable workflows at the full release commit SHA — exact YAML in
   [docs/installation.md](docs/installation.md).

5. Merge to the default branch, let the baseline workflow publish the first baseline, then open a
   PR to see the comparison run.

## CLI

The package installs one binary, `visual-regression`. The reusable workflows invoke it directly.

| Command                                      | Purpose                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `visual-regression baseline create`          | Build, start, discover routes, capture every route/project pair, create a complete baseline manifest, and verify it.              |
| `visual-regression baseline verify <dir>`    | Validate a baseline directory: manifest identity, compatibility metadata, paths, dimensions, and SHA-256 checksums.               |
| `visual-regression compare --baseline <dir>` | Build and capture a candidate, verify the baseline, compare all route/project pairs (changed, added, removed), and write results. |
| `visual-regression report`                   | Print or open the latest HTML report.                                                                                             |
| `visual-regression config hash`              | Print the normalized visual-contract hash for the loaded config; used by workflows for exact baseline lookup.                     |

Common flags: `--config <path>` (config file location), `--json` (machine-readable stdout; logs go
to stderr), and `--host` for diagnostic-only host execution — host screenshots are never
authoritative or CI-comparable.

## Statuses and exit codes

Every `baseline create` and `compare` run writes a schema-validated
`.visual-regression/result/visual-result.json` and `visual-summary.md`.

| Status                 | Exit | Meaning                                                                                                               |
| ---------------------- | ---: | --------------------------------------------------------------------------------------------------------------------- |
| `pass`                 |  `0` | `baseline-create` produced a complete verified baseline, or `compare` completed with no differences.                  |
| `infrastructure-error` |  `1` | The requested operation could not complete or cannot be trusted. Always fails the workflow.                           |
| `visual-diff`          |  `2` | A complete, verified `compare` found changed, added, or removed route/project screenshots. Advisory in CI by default. |

`visual-diff` is valid only for `compare`; exit `2` never represents an incomplete comparison,
missing baseline, or setup failure. Stable error codes (for example `BASELINE_NOT_FOUND`,
`VISUAL_CONTRACT_CHANGED`, `TOOLKIT_VERSION_MISMATCH`) are documented with operator responses in
[docs/operations.md](docs/operations.md).

## Documentation

- [docs/installation.md](docs/installation.md) — full consumer setup: package, config, gitignore,
  workflow callers, and seed-and-verify steps.
- [docs/operations.md](docs/operations.md) — baseline lifecycle, retrieval failure codes and what
  to do about them, config-changing PRs, upgrades and rollback, intentional visual changes.
- [docs/architecture.md](docs/architecture.md) — responsibility split, determinism model, baseline
  identity, result contract, workflow security model.
- [docs/release.md](docs/release.md) — release coupling (package, workflow SHA, Playwright,
  Chromium, container, schemas) and the release checklist.
