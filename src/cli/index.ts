/**
 * CLI (plan §5.4, §10). Commands:
 *   visual-regression baseline create [--config <path>] [--host] [--json]
 *   visual-regression baseline verify <dir> [--json]
 *   visual-regression compare --baseline <dir> [--config <path>] [--host] [--json]
 *   visual-regression report
 *
 * Exit codes: 0 pass, 1 infrastructure-error, 2 visual-diff (compare only).
 * Logs to stderr; stdout carries JSON when --json is set. Every baseline
 * create / compare run clears and rewrites the fixed §10 output directories
 * and writes a schema-valid visual-result.json even on failure. --host must
 * warn that host screenshots are not authoritative or CI-comparable.
 *
 * Orchestration per operation:
 *   baseline create: loadConfig -> hash -> clear dirs -> runBuild(with clock
 *     env) -> discoverRoutes -> startServer -> captureRoutes -> stop ->
 *     createBaseline -> verifyBaseline -> writeResult.
 *   compare: loadConfig -> hash -> verifyBaseline(--baseline dir) ->
 *     checkBaselineCompatibility -> build/discover/capture candidate using
 *     the baseline's logicalDate -> compareAgainstBaseline -> writeResult.
 */
export async function runCli(argv: string[]): Promise<number> {
  void argv;
  throw new Error('not implemented');
}
