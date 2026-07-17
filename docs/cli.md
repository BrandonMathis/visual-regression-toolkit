# CLI and outputs

Build the toolkit from a clone of GitHub `main`, then invoke `dist/cli/main.js` with Node. The reusable workflows do this automatically; the commands below are primarily for host diagnostics.

## Commands

- `baseline create`: build, start, discover, capture every route/project pair, write a complete manifest, and verify it.
- `baseline verify <dir>`: independently validate schema, safe paths, complete pair sets, PNG dimensions/sizes/checksums, and absence of extra files.
- `compare --baseline <dir>`: verify the baseline, reuse its logical date, build/capture a candidate, verify the baseline again immediately before comparison, and compare complete route/project sets.
- `report [--open]`: print or open the latest isolated HTML report.

`--config` defaults to `visual-regression.config.ts`; `--json` reserves stdout for JSON and logs to stderr. `--host` is mandatory outside an authoritative workflow. Workflows also supply `--repository`, full `--source-sha`/`--base-sha`, `--base-branch`, `--run-id`, `--run-attempt`, and `--logical-date`. Consumers should not script those identity options.

## Exit/status matrix

| Exit | Status                 | Meaning                                                              |
| ---: | ---------------------- | -------------------------------------------------------------------- |
|    0 | `pass`                 | Complete verified baseline or unchanged complete comparison          |
|    1 | `infrastructure-error` | Build, server, capture, baseline, identity, schema, or setup failure |
|    2 | `visual-diff`          | Complete comparison with changed, added, or removed pairs            |

Exit 2 never means partial comparison or missing baseline.

## Output

- `.visual-regression/baseline/baseline-manifest.json` and `screenshots/**`
- `.visual-regression/candidate/screenshots/**`
- `.visual-regression/result/visual-result.json`, `visual-summary.md`, `visual-report.html`, and `diffs/**`
- `playwright-report/visual/`
- `test-results/visual/`

Generated output is replaceable and should not be committed. The manifest records exact source/workflow/runtime identity, logical date, contract hash, routes/projects, and PNG metadata/checksums. JSON schemas are committed under `schemas/` and travel with the GitHub source.
