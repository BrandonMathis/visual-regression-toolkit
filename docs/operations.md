# Operations guide

How baselines live and die, what every retrieval failure code means, and the procedures for config
changes, upgrades, rollback, and intentional visual changes.

## Baseline lifecycle

### Publication rules

The reusable baseline workflow (`visual-baseline.yml`) publishes a baseline for every
default-branch push, on a monthly schedule, and on manual dispatch. Each run:

1. Resolves the full source SHA and one logical date at job start.
2. Injects the logical date into the configured clock environment variable (default
   `VISUAL_TEST_DATE`) for build, start, and capture.
3. Builds, discovers routes, and captures every required route/project pair.
4. Writes `baseline-manifest.json` only after every capture succeeds.
5. Verifies the manifest and every screenshot checksum in a separate process.
6. Uploads the manifest and screenshots as one immutable artifact.

A partial baseline is never published, and the workflow reports success only after the immutable
artifact upload itself succeeds. Artifact names follow
`visual-baseline-<sha12>-<config12>-<run-id>-<attempt>`, but names are lookup aids only — the
verified manifest content is authoritative.

### 90-day expiry and the monthly schedule

Baselines are GitHub Actions artifacts retained for 90 days (`retention-days: 90`). An active
repository refreshes its baseline on every default-branch push, so expiry is invisible. A quiet
repository would eventually have no unexpired baseline for its default-branch tip, and every PR
would fail with `BASELINE_NOT_FOUND`. The monthly `schedule` trigger in the baseline caller exists
solely to re-publish a fresh artifact for the same tip commit well inside the 90-day window.

## Exact-SHA baseline retrieval

For every pull request the comparison workflow:

1. Reads `github.event.pull_request.base.sha` once at job start.
2. Computes the candidate's normalized visual-contract hash with the workflow-paired package
   version.
3. Lists successful baseline workflow runs for that exact base SHA.
4. Inspects their verified manifests and finds artifacts matching the complete compatibility
   identity (repository, exact SHA, contract hash, toolkit major/schema, Playwright/Chromium
   identity, container digest/platform).
5. Selects deterministically: highest successful run ID, then highest run attempt.
6. If publication for that exact SHA is still in progress, waits up to 10 minutes.
7. Downloads the artifact outside generated result directories and verifies the manifest and every
   checksum after download and again immediately before comparison.
8. Reuses the baseline manifest's logical date for the candidate build, start, and capture.

It never falls back to committed screenshots, the latest baseline regardless of SHA, an ancestor or
newer default-branch commit, another repository, a different config hash, or a different
browser/container identity.

## Failure codes and operator responses

All of these are infrastructure errors: status `infrastructure-error`, exit `1`, always a red
check. Advisory mode never applies to them.

| Code                       | Meaning                                                                                                                                                                     | Operator response                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASELINE_NOT_FOUND`       | No successful baseline run/artifact exists for the PR's exact base SHA (never published, or expired).                                                                       | Run the baseline workflow manually (`workflow_dispatch`) on the default branch, wait for it to publish, then re-run the comparison. If baselines keep expiring, confirm the monthly schedule is enabled.                                                  |
| `BASELINE_NOT_READY`       | Baseline publication for the exact base SHA is in progress but did not finish within the 10-minute wait.                                                                    | Wait for the baseline run to complete, then re-run the comparison job. If the baseline run failed, fix it and re-run it first.                                                                                                                            |
| `BASELINE_CORRUPT`         | The downloaded artifact failed verification: bad manifest, missing/extra files, or checksum/dimension drift.                                                                | Do not trust the artifact. Re-publish a baseline for the same SHA (new run supersedes the corrupt one by run-ID selection) and re-run the comparison. Recurring corruption suggests artifact tampering or an upload problem — investigate before merging. |
| `BASELINE_INCOMPATIBLE`    | A baseline exists for the SHA but its repository, toolkit major/schema, Playwright/Chromium, or container/platform identity differs.                                        | Usually a half-applied upgrade: package version and workflow SHA moved separately. Align both to one release ([release.md](release.md)), publish a fresh baseline from the default branch, then re-run.                                                   |
| `VISUAL_CONTRACT_CHANGED`  | An otherwise compatible base-SHA baseline exists, but the PR's normalized visual-contract hash differs — the PR changes the config in a pixel- or comparison-affecting way. | Expected for config-changing PRs. Follow the waiver rollout below; do not try to regenerate a baseline for the old commit with the new config.                                                                                                            |
| `TOOLKIT_VERSION_MISMATCH` | The consumer's manifest/lockfile does not resolve exactly the package version the workflow release embeds. Fails before any configuration is evaluated or screenshots run.  | Reinstall with `npm install --save-dev --save-exact @thisdot/visual-regression@<paired version>`, commit `package.json` and the lockfile, or move the workflow SHA to the release paired with the installed version.                                      |

## Config-changing PRs (the waiver rollout)

A changed visual-contract hash cannot use the existing baseline: the two configs would not produce
comparable pixels, and version 1 will not synthesize an ephemeral baseline for a new contract. The
comparison instead returns `VISUAL_CONTRACT_CHANGED`. The reviewed rollout is:

1. Review the config change itself carefully — screenshots cannot help here.
2. Merge the PR with an explicit check waiver (admin bypass or the equivalent documented override
   for your branch protection). The waiver applies only to this known, reviewed cause.
3. The merge pushes to the default branch, which publishes a baseline from the resulting commit
   under the new contract hash.
4. Normal PR comparisons resume automatically once that baseline exists. PRs opened against the
   pre-merge base may need a rebase onto the new default-branch tip.

## Upgrades and rollback

The exact package version and the reusable-workflow commit SHA are one unit
([release.md](release.md) records the pairs). The workflow embeds its expected package version and
enforces the pairing with `TOOLKIT_VERSION_MISMATCH`.

To upgrade:

1. In one PR, bump the exact dependency and move both callers' `@FULL_RELEASE_COMMIT_SHA` to the
   new release SHA.
2. If the release changes Playwright, Chromium, the container, stabilization defaults, or anything
   else pixel-affecting, existing baselines become incompatible by design; this PR may need the
   config-change-style waiver.
3. Merge, and let the default-branch push publish a baseline under the new runtime identity.

To roll back: restore both the previous exact package version and the previous workflow SHA
together, merge, and publish a compatible baseline the same way. Never move one side alone.

## Intentional visual changes

A deliberate redesign or content change is a normal `visual-diff` (exit `2`), which the workflow
reports as an advisory success with a warning summary — it does not block merging by default.

1. Open the PR; the comparison reports `visual-diff` with changed/added/removed route/project pairs.
2. Download the HTML report and diff artifacts, and review that every difference is intended.
3. Merge. The default-branch push publishes a new baseline containing the new appearance.
4. Subsequent PRs compare against the new baseline; nothing else needs to be done.

If your repository treats the comparison as a required check with advisory mode disabled, the
reviewer accepts the diff by approving and merging — there is no separate approval service in
version 1.
