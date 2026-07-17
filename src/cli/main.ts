#!/usr/bin/env node
import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createBaseline,
  compareBaseline,
  type ExecutionIdentity,
} from "../application/operations.js";
import { verifyBaseline } from "../baseline/verify.js";
import {
  asVisualError,
  VisualRegressionError,
} from "../contracts/error-codes.js";
import type { VisualResult } from "../contracts/types.js";
import { releaseIdentity } from "../platform/release.js";
import { errorResult } from "../result/builder.js";
import { writeResult } from "../result/write.js";
import { exitCodeForStatus } from "./exit-code.js";
import { runWorkflowCli } from "../workflow/cli.js";

type Options = Record<string, string | boolean>;
function parse(args: string[]): { positionals: string[]; options: Options } {
  const positionals: string[] = [];
  const options: Options = {};
  for (let index = 0; index < args.length; index++) {
    const item = args[index]!;
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const key = item.slice(2);
    if (!key)
      throw new VisualRegressionError("CONFIG_INVALID", "Invalid empty option");
    if (["host", "json", "open", "help"].includes(key)) options[key] = true;
    else {
      const next = args[++index];
      if (!next || next.startsWith("--"))
        throw new VisualRegressionError(
          "CONFIG_INVALID",
          `Option --${key} requires a value`,
        );
      options[key] = next;
    }
  }
  return { positionals, options };
}
function text(options: Options, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}
function gitSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}
async function identity(
  root: string,
  options: Options,
): Promise<ExecutionIdentity> {
  const host = options.host === true;
  const authoritative = process.env.VISUAL_REGRESSION_AUTHORITATIVE === "1";
  if (!host && !authoritative)
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Use --host for diagnostic host execution; authoritative execution requires the pinned container workflow",
    );
  if (authoritative && (process.platform !== "linux" || process.arch !== "x64"))
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Authoritative execution requires linux/amd64",
    );
  if (host)
    console.error(
      "WARNING: host screenshots are diagnostic and are not authoritative or CI-comparable.",
    );
  const sourceSha = text(
    options,
    "source-sha",
    process.env.GITHUB_SHA ?? gitSha(root),
  );
  const baseSha = text(
    options,
    "base-sha",
    process.env.VISUAL_BASE_SHA ?? sourceSha,
  );
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{40}$/.test(baseSha))
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Source and base SHAs must be full lowercase 40-character hexadecimal values",
    );
  const logicalDate = text(
    options,
    "logical-date",
    process.env.VISUAL_LOGICAL_DATE ?? new Date().toISOString(),
  );
  if (!Number.isFinite(Date.parse(logicalDate)))
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Logical date must be an ISO date-time",
    );
  const workflowRunAttempt = Number(
    text(options, "run-attempt", process.env.GITHUB_RUN_ATTEMPT ?? "1"),
  );
  if (!Number.isInteger(workflowRunAttempt) || workflowRunAttempt < 1)
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Run attempt must be a positive integer",
    );
  return {
    consumerRepository: text(
      options,
      "repository",
      process.env.GITHUB_REPOSITORY ?? "local/local",
    ),
    baseBranch: text(
      options,
      "base-branch",
      process.env.GITHUB_BASE_REF ?? "main",
    ),
    sourceSha,
    baseSha,
    workflowRunId: text(options, "run-id", process.env.GITHUB_RUN_ID ?? "0"),
    workflowRunAttempt,
    logicalDate: new Date(logicalDate).toISOString(),
    release: await releaseIdentity(authoritative),
  };
}
const help = `Usage: visual-regression <command> [options]\n\nCommands:\n  baseline create             Build, capture, and verify a baseline\n  baseline verify <dir>       Verify a baseline from hostile input\n  compare --baseline <dir>    Compare a candidate to a verified baseline\n  report [--open]             Print or open the latest HTML report\n\nCapture options: --config <path> --host --json --repository <owner/name> --source-sha <sha> --base-sha <sha>`;
async function emit(
  root: string,
  result: VisualResult,
  json: boolean,
): Promise<number> {
  await writeResult(root, result);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.error(`visual-regression: ${result.status}`);
  return exitCodeForStatus(result.status);
}
export async function runCli(argv: string[]): Promise<number> {
  if (argv[0] === "workflow") return runWorkflowCli(argv.slice(1));
  const root = process.cwd();
  const { positionals, options } = parse(argv);
  if (options.help || !positionals.length) {
    process.stdout.write(`${help}\n`);
    return 0;
  }
  const configPath = text(options, "config", "visual-regression.config.ts");
  if (positionals[0] === "baseline" && positionals[1] === "verify") {
    const unknown = Object.keys(options).find((key) => key !== "json");
    if (unknown || positionals.length !== 3)
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        unknown
          ? `Unknown option --${unknown}`
          : "Invalid baseline verify arguments",
      );
    const directory = positionals[2];
    if (!directory)
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        "baseline verify requires a directory",
      );
    const baselineRoot = path.resolve(root, directory);
    const preliminary = await verifyBaseline(baselineRoot);
    const verified = await verifyBaseline(baselineRoot, {
      consumerRepository: preliminary.manifest.consumerRepository,
      sourceSha: preliminary.manifest.sourceSha,
      visualContractHash: preliminary.manifest.visualContractHash,
      release: await releaseIdentity(
        preliminary.manifest.release.authoritative,
      ),
    });
    if (options.json)
      process.stdout.write(
        `${JSON.stringify({ valid: true, manifest: verified.manifest })}\n`,
      );
    else
      console.error(
        `Verified ${verified.manifest.screenshots.length} screenshots.`,
      );
    return 0;
  }
  if (positionals[0] === "report") {
    const unknown = Object.keys(options).find((key) => key !== "open");
    if (unknown || positionals.length !== 1)
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        unknown ? `Unknown option --${unknown}` : "Invalid report arguments",
      );
    const playwrightReport = path.join(
      root,
      "playwright-report/visual/index.html",
    );
    const fallbackReport = path.join(
      root,
      ".visual-regression/result/visual-report.html",
    );
    const report = await readFile(fallbackReport)
      .then(() => fallbackReport)
      .catch(async () => {
        await readFile(playwrightReport);
        return playwrightReport;
      });
    if (options.open)
      execFile(
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "cmd"
            : "xdg-open",
        process.platform === "win32" ? ["/c", "start", "", report] : [report],
        () => {},
      );
    else process.stdout.write(`${report}\n`);
    return 0;
  }
  const operation =
    positionals[0] === "baseline" && positionals[1] === "create"
      ? "baseline-create"
      : positionals[0] === "compare"
        ? "compare"
        : undefined;
  if (!operation)
    throw new VisualRegressionError("CONFIG_INVALID", "Unknown command");
  let sourceSha = text(
    options,
    "source-sha",
    process.env.GITHUB_SHA ?? gitSha(root),
  );
  try {
    if (
      (operation === "baseline-create" && positionals.length !== 2) ||
      (operation === "compare" && positionals.length !== 1)
    )
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        "Invalid command arguments",
      );
    const allowed = new Set([
      "config",
      "host",
      "json",
      "repository",
      "source-sha",
      "base-sha",
      "base-branch",
      "run-id",
      "run-attempt",
      "logical-date",
      ...(operation === "compare" ? ["baseline"] : []),
    ]);
    const unknown = Object.keys(options).find((key) => !allowed.has(key));
    if (unknown)
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        `Unknown option --${unknown}`,
      );
    if (operation === "compare" && typeof options.baseline !== "string")
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        "compare requires --baseline <dir>",
      );
    const execution = await identity(root, options);
    sourceSha = execution.sourceSha;
    const result =
      operation === "baseline-create"
        ? await createBaseline(root, configPath, execution)
        : await compareBaseline(
            root,
            configPath,
            path.resolve(root, text(options, "baseline", "")),
            execution,
          );
    return emit(root, result, options.json === true);
  } catch (error) {
    const visual = asVisualError(error);
    const result = errorResult(
      operation,
      /^[a-f0-9]{40}$/.test(sourceSha) ? sourceSha : "unknown",
      visual,
    );
    try {
      return await emit(root, result, options.json === true);
    } catch (writeError) {
      const secondary = asVisualError(writeError);
      console.error(
        `${visual.code}: ${visual.message}; result write failed: ${secondary.message}`,
      );
      return 1;
    }
  }
}
runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const visual = asVisualError(error);
    console.error(`${visual.code}: ${visual.message}`);
    process.exitCode = 1;
  });
