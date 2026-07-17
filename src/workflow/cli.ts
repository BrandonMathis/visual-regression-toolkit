import path from "node:path";
import { inspectConsumer, scanArtifactTree } from "./consumer.js";
import { resolveBaseline } from "./resolve-baseline.js";
import { validateWorkflowResult } from "./result-gate.js";
import { VisualRegressionError } from "../contracts/error-codes.js";

type Parsed = { positionals: string[]; options: Record<string, string> };
function parse(args: string[]): Parsed {
  const positionals: string[] = [],
    options: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const item = args[index]!;
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        `Option ${item} requires a value`,
      );
    options[item.slice(2)] = value;
  }
  return { positionals, options };
}
function required(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value)
    throw new VisualRegressionError("CONFIG_INVALID", `Missing --${key}`);
  return value;
}
function exactOptions(
  options: Record<string, string>,
  allowed: string[],
): void {
  const unknown = Object.keys(options).find((key) => !allowed.includes(key));
  if (unknown)
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      `Unknown option --${unknown}`,
    );
}
export async function runWorkflowCli(args: string[]): Promise<number> {
  const { positionals, options } = parse(args);
  const command = positionals[0];
  if (!command || positionals.length !== 1)
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Invalid workflow helper command",
    );
  if (command === "inspect-consumer") {
    exactOptions(options, ["root", "config"]);
    const value = await inspectConsumer(
      path.resolve(options.root ?? process.cwd()),
      options.config ?? "visual-regression.config.ts",
    );
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return 0;
  }
  if (command === "scan-tree") {
    exactOptions(options, ["path"]);
    const value = await scanArtifactTree(
      path.resolve(required(options, "path")),
    );
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return 0;
  }
  if (command === "resolve-baseline") {
    exactOptions(options, [
      "repository",
      "repository-id",
      "base-sha",
      "contract-hash",
      "base-branch",
      "workflow-file",
      "output",
      "wait-seconds",
    ]);
    const wait = Number(options["wait-seconds"] ?? "600");
    if (!Number.isInteger(wait) || wait < 0 || wait > 600)
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        "Invalid bounded wait duration",
      );
    const value = await resolveBaseline({
      repository: required(options, "repository"),
      repositoryId: required(options, "repository-id"),
      baseSha: required(options, "base-sha"),
      contractHash: required(options, "contract-hash"),
      baseBranch: required(options, "base-branch"),
      workflowFile: required(options, "workflow-file"),
      output: path.resolve(required(options, "output")),
      token: process.env.GITHUB_TOKEN ?? "",
      waitSeconds: wait,
    });
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return 0;
  }
  if (command === "validate-result") {
    exactOptions(options, [
      "root",
      "operation",
      "exit-code",
      "candidate-sha",
      "baseline-sha",
      "contract-hash",
      "summary",
      "informational",
    ]);
    const operation = required(options, "operation");
    if (operation !== "baseline-create" && operation !== "compare")
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        "Invalid result operation",
      );
    const exitCode = Number(required(options, "exit-code"));
    if (![0, 1, 2].includes(exitCode))
      throw new VisualRegressionError(
        "RESULT_INVALID",
        "Unexpected CLI exit code",
      );
    const value = await validateWorkflowResult({
      root: path.resolve(options.root ?? process.cwd()),
      operation,
      exitCode,
      candidateSha: required(options, "candidate-sha"),
      ...(options["baseline-sha"]
        ? { baselineSha: options["baseline-sha"] }
        : {}),
      ...(options["contract-hash"]
        ? { contractHash: options["contract-hash"] }
        : {}),
      summaryPath: path.resolve(required(options, "summary")),
      informational: (options.informational ?? "false") === "true",
    });
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return 0;
  }
  throw new VisualRegressionError(
    "CONFIG_INVALID",
    "Unknown workflow helper command",
  );
}
