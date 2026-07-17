# Errors and troubleshooting

All infrastructure errors use exit 1 and a bounded stable code/message in `visual-result.json` when consumer execution began.

| Code                                              | Action                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_INVALID`                                  | Remove unknown/unsafe values; use a loopback server and supported config.                                                                                |
| `BUILD_FAILED`, `SERVER_FAILED`, `SERVER_TIMEOUT` | Reproduce the production build/start with the logical date and inspect diagnostics.                                                                      |
| `ROUTE_DISCOVERY_FAILED`                          | Build first; verify supported Next prerender manifest and a nonempty resolved route set.                                                                 |
| `CAPTURE_FAILED`                                  | Inspect route/project context, readiness/fonts/resources, bounds, and the Playwright report.                                                             |
| `BASELINE_NOT_FOUND`                              | Publish a baseline for the exact PR base SHA.                                                                                                            |
| `BASELINE_NOT_READY`                              | Exact-SHA publication remained active beyond the bounded ten-minute wait.                                                                                |
| `BASELINE_EXPIRED`                                | Republish on the current default-branch SHA.                                                                                                             |
| `BASELINE_ARTIFACT_UNAVAILABLE`                   | The API cannot prove expiry; republish rather than falling back.                                                                                         |
| `BASELINE_CORRUPT`                                | Artifact/archive/manifest/checksum validation failed; republish and investigate tampering.                                                               |
| `BASELINE_INCOMPATIBLE`                           | Repository, SHA, toolkit-main commit, runtime, schema, platform, run, or branch identity differs. Publish a fresh baseline after toolkit `main` changes. |
| `VISUAL_CONTRACT_CHANGED`                         | Follow the reviewed config-change rollout.                                                                                                               |
| `BASELINE_API_ERROR`                              | Check caller `actions: read`, GitHub availability/rate limits, and retry.                                                                                |
| `RESULT_INVALID`, `RESULT_IDENTITY_MISMATCH`      | Treat as blocking; result shape, size, exit/status, evidence, or trusted identity disagrees.                                                             |

A visual difference is not an error: download evidence, review changed/added/removed pairs, and merge only if intentional. Never solve baseline errors by selecting `latest`, committed screenshots, another repository, another SHA, or another runtime.
