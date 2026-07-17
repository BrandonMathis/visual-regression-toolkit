# Distribution, runtime coupling, and tagging

The toolkit is distributed directly from GitHub: consumers install the package with
`npm install --save-dev github:BrandonMathis/visual-regression-toolkit` and reference the reusable
workflows at `@main`. There is no npm registry publication. The package and the workflows live in
this repository and move together on `main`; the workflows embed the package version they pair
with and fail with `TOOLKIT_VERSION_MISMATCH` when a consumer's locked install has drifted from
them.

## Release coupling table

These are the pinned values for toolkit 1.0.0 (source of truth: `src/runtime.ts` and
`package.json`). Everything below is coupled: whenever any pixel-affecting value changes on
`main`, the `package.json` version is bumped in the same commit so stale consumer installs fail
fast with `TOOLKIT_VERSION_MISMATCH` instead of comparing incompatibly.

| Component                | Pinned value                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Package                  | `@thisdot/visual-regression@1.0.0`, installed as `github:BrandonMathis/visual-regression-toolkit` |
| Reusable-workflow ref    | `@main` (or the same git tag as the package install ref, when pinning a tag)                      |
| Node                     | 22 (major)                                                                                        |
| Playwright               | `1.61.1` (exact)                                                                                  |
| Chromium                 | revision `1228` (149.0.7827.55)                                                                   |
| Container image          | `mcr.microsoft.com/playwright:v1.61.1-noble`                                                      |
| Container digest         | `sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`                         |
| Container platform       | `linux/amd64`                                                                                     |
| Baseline manifest schema | version 1                                                                                         |
| Visual result schema     | version 1                                                                                         |
| Stabilization behavior   | version 1                                                                                         |
| next-prerender adapter   | behavior version 1                                                                                |

A change to Playwright, Chromium, the container, a stabilization default, or any other
pixel-affecting value requires a coordinated toolkit release and new consumer baselines. The
stabilization and adapter behavior versions feed the visual-contract hash, so bumping them
invalidates existing baselines by design.

## Distribution

Consumers install from GitHub, which keeps PR installation tokenless (the repository is public).
`package.json` declares a `prepare` script, so `npm install github:...` builds `dist/` during
installation. There is no npm publishing pipeline and no npm token anywhere in the workflows.

Git tags are optional. When a state of `main` is worth naming, tag it `v<package version>`; the
Release workflow verifies the full check suite and the coupling, then creates a GitHub release
whose notes record the pairing. Consumers who prefer a fixed ref over tracking `main` can then
install `github:BrandonMathis/visual-regression-toolkit#v<version>` and reference the workflows
at the same tag. Tags and release records are never rewritten.

## Tagging checklist

Before tagging:

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
5. The release record pairs the package version with the workflow commit SHA, Node major, exact
   Playwright version, Chromium revision, container digest/platform, and manifest/result schema
   versions — the table above, updated for the new values.
6. Focused reviews of baseline correctness, workflow security, and screenshot determinism have no
   unresolved blocker or high-severity findings.
7. The released package/workflow pair passes the complete fixture lifecycle: baseline publication,
   unchanged comparison, deliberate pixel change, added/removed routes, every infrastructure
   failure, exact-SHA rejection, logical-date reuse, and malformed untrusted-output handling.
8. Push the tag (`git tag v<version> && git push origin v<version>`); the Release workflow runs
   the full suite again and creates the GitHub release with the coupling recorded in its notes.

After release, a clean consumer must be able to adopt the toolkit using only
[installation.md](installation.md).
