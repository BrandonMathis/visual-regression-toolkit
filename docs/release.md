# Release coupling and checklist

One toolkit release binds every runtime value that can affect pixels or compatibility. Consumers
move the exact package version and the reusable-workflow commit SHA together; the workflow embeds
its expected package version and fails with `TOOLKIT_VERSION_MISMATCH` on any drift.

## Release coupling table

These are the pinned values for toolkit 1.0.0 (source of truth: `src/runtime.ts` and
`package.json`).

| Component                | Pinned value                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Package                  | `@thisdot/visual-regression@1.0.0` (exact)                                                   |
| Reusable-workflow ref    | Full release commit SHA recorded in the release notes (`FULL_RELEASE_COMMIT_SHA` in callers) |
| Node                     | 22 (major)                                                                                   |
| Playwright               | `1.61.1` (exact)                                                                             |
| Chromium                 | revision `1228` (149.0.7827.55)                                                              |
| Container image          | `mcr.microsoft.com/playwright:v1.61.1-noble`                                                 |
| Container digest         | `sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`                    |
| Container platform       | `linux/amd64`                                                                                |
| Baseline manifest schema | version 1                                                                                    |
| Visual result schema     | version 1                                                                                    |
| Stabilization behavior   | version 1                                                                                    |
| next-prerender adapter   | behavior version 1                                                                           |

A change to Playwright, Chromium, the container, a stabilization default, or any other
pixel-affecting value requires a coordinated toolkit release and new consumer baselines. The
stabilization and adapter behavior versions feed the visual-contract hash, so bumping them
invalidates existing baselines by design.

## Publishing

Version 1 publishes to public npm — PR installation must be tokenless — with package provenance
via trusted publishing (OIDC). No npm token is stored in workflow secrets, and published versions
and release tags are never rewritten.

## Release checklist

Before tagging a release:

1. All required repository checks pass on the release commit:

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

2. The release commit couples the workflows to the released package: `EXPECTED_TOOLKIT_VERSION`
   in `.github/workflows/visual-baseline.yml` and `.github/workflows/visual-regression.yml`
   equals the `package.json` version, and the runtime identity values in the release workflow's
   `env` block (and every container pin) match `src/runtime.ts`. The release workflow's verify
   job enforces both and fails the release on drift.
3. `npm pack --dry-run` contains only intended files (`dist`, `schemas`, `README.md`, `LICENSE`).
4. Documentation reflects the release: configuration, CLI commands, workflow inputs, artifacts,
   result codes, and baseline lifecycle; plus seeding, artifact expiry, config-changing PR
   rollout, upgrade, rollback, and intentional-visual-change procedures.
5. The release record pairs the exact npm package version with the immutable workflow commit SHA,
   Node major, exact Playwright version, Chromium revision, container digest/platform, and
   manifest/result schema versions — the table above, updated for the new values.
6. Focused reviews of baseline correctness, workflow security, and screenshot determinism have no
   unresolved blocker or high-severity findings.
7. The released package/workflow pair passes the complete fixture lifecycle: baseline publication,
   unchanged comparison, deliberate pixel change, added/removed routes, every infrastructure
   failure, exact-SHA rejection, logical-date reuse, and malformed untrusted-output handling.
8. Publish the immutable release: npm publish via trusted publishing, then a release tag whose
   notes record the pairing so consumers can fill in `FULL_RELEASE_COMMIT_SHA`.

After release, a clean consumer must be able to adopt the toolkit using only
[installation.md](installation.md).
