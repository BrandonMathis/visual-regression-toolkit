# Reusable workflows from GitHub main

Consumers call the shared workflows directly from `BrandonMathis/visual-regression-toolkit@main`. No npm package, package version, release commit, or package registry credential is required.

Each run reads the already-resolved reusable-workflow commit from GitHub's trusted `job_workflow_sha` OIDC claim, records it, and uses that exact commit in every job. The workflow YAML and toolkit CLI therefore come from the same resolution of `main`. Third-party actions and the Playwright container remain pinned inside the shared workflow.

## Baseline caller

```yaml
name: Visual Baseline
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 8 1 * *"
  workflow_dispatch:
permissions:
  contents: read
  id-token: write # consumed only by the clean toolkit-identity job
jobs:
  baseline:
    uses: BrandonMathis/visual-regression-toolkit/.github/workflows/visual-baseline.yml@main
    with:
      config-path: visual-regression.config.ts
      node-version: "22"
      retention-days: 90
```

The reusable workflow rejects feature refs and tags, captures the full default-branch SHA and one UTC logical date, checks out that SHA without persisted credentials, installs consumer dependencies without secrets, loads and builds the toolkit from GitHub `main`, captures in the pinned `linux/amd64` container, verifies the baseline in a fresh process, and uploads one immutable baseline artifact. Concurrency is per source SHA with cancellation disabled.

## Pull-request caller

```yaml
name: Visual Regression
on:
  pull_request:
    branches: [main]
permissions:
  actions: read
  contents: read
  id-token: write # consumed only by the clean toolkit-identity job
concurrency:
  group: visual-regression-${{ github.event.pull_request.number }}-${{ github.event.pull_request.base.sha }}-${{ github.event.pull_request.head.sha }}
  cancel-in-progress: true
jobs:
  compare:
    uses: BrandonMathis/visual-regression-toolkit/.github/workflows/visual-regression.yml@main
    with:
      config-path: visual-regression.config.ts
      baseline-workflow-file: visual-baseline.yml
      node-version: "22"
      visual-diffs-are-informational: true
```

Do not pass secrets, use `secrets: inherit`, attach an environment, or use `pull_request_target`. The caller grants `id-token: write` only so the clean `toolkit-identity` job can read GitHub's signed `job_workflow_sha` claim; jobs that execute consumer code explicitly do not receive that permission.

The comparison workflow validates base/head/synthetic-merge SHAs and merge parents. Its first clean job reads the called workflow's resolved `main` commit before any consumer checkout or dependency execution. Resolver, capture, and trusted-gate jobs all load that exact toolkit commit so `main` cannot drift during one workflow run.

A no-consumer-code resolver receives only `actions: read`, paginates exact-base-SHA runs/artifacts, safely extracts candidates, verifies complete manifests, waits at most ten minutes for active publication, and relays the selected baseline by artifact ID. The unprivileged consumer job captures and uploads fixed evidence. A separate final gate never checks out or executes consumer code and is the only job allowed to convert a fully validated exit `2` to advisory success.

## Moving `main`

There is no package/workflow version pair to upgrade. Consumers automatically use the current toolkit on their next workflow run.

A baseline records the exact toolkit Git commit. If `main` changes after a baseline was published, comparison fails closed with an incompatible-baseline infrastructure result. Run the baseline workflow on the consumer's current default-branch SHA to seed evidence with the new toolkit commit, then resume pull-request comparisons.

Optional Git tags can mark known points in repository history. Consumer workflows still follow `main` unless their caller is intentionally changed by a maintainer.

Artifacts: `visual-baseline-*` (authoritative, normally 90 days), baseline diagnostics (14 days), one-day resolver relay, and PR visual evidence (14 days). Artifacts are repository-readable evidence and must never contain secrets.
