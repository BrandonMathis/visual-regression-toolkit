import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateResult } from "../contracts/validate.js";
import type { Difference, VisualResult } from "../contracts/types.js";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { parseJsonWithoutDuplicateKeys } from "../platform/strict-json.js";
import { inspectPng } from "../baseline/checksum.js";
import {
  CHROMIUM_REVISION,
  CONTAINER_DIGEST,
  PLAYWRIGHT_VERSION,
  toolkitRevision,
} from "../platform/release.js";

export type GateOptions = {
  root: string;
  operation: "baseline-create" | "compare";
  exitCode: number;
  candidateSha: string;
  baselineSha?: string;
  contractHash?: string;
  summaryPath: string;
  informational: boolean;
};
const safeRelative = (value: string): boolean =>
  value.length <= 4096 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").includes("..");
const markdownCharacters = "\\`*_{}[]()<>#+.!|\r\n";
const escape = (value: string): string =>
  [...value]
    .map((character) =>
      markdownCharacters.includes(character) ? `\\${character}` : character,
    )
    .join("")
    .slice(0, 2048);
function pairs(
  items: Difference[],
  kind: "changed" | "added" | "removed",
): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const key = `${item.project}\0${item.route}`;
    if (set.has(key))
      throw new Error("Result contains duplicate route/project evidence");
    set.add(key);
    const required =
      kind === "changed"
        ? [item.expectedPath, item.actualPath, item.diffPath]
        : kind === "added"
          ? [item.actualPath]
          : [item.expectedPath];
    if (required.some((candidate) => !candidate))
      throw new Error(`${kind} evidence is missing required paths`);
    if (
      (kind === "changed" &&
        (!item.expectedPath?.startsWith(
          ".visual-regression/baseline/screenshots/",
        ) ||
          !item.actualPath?.startsWith(
            ".visual-regression/candidate/screenshots/",
          ) ||
          !item.diffPath?.startsWith(".visual-regression/result/diffs/") ||
          !Number.isInteger(item.differingPixels) ||
          !Number.isInteger(item.totalPixels) ||
          (item.differingPixels ?? 0) < 1 ||
          (item.totalPixels ?? 0) < (item.differingPixels ?? 0))) ||
      (kind === "added" &&
        (!item.actualPath?.startsWith(
          ".visual-regression/candidate/screenshots/",
        ) ||
          item.expectedPath !== undefined ||
          item.diffPath !== undefined)) ||
      (kind === "removed" &&
        (!item.expectedPath?.startsWith(
          ".visual-regression/baseline/screenshots/",
        ) ||
          item.actualPath !== undefined ||
          item.diffPath !== undefined))
    )
      throw new Error(`${kind} evidence paths or metadata are inconsistent`);
    for (const candidate of [item.expectedPath, item.actualPath, item.diffPath])
      if (candidate && !safeRelative(candidate))
        throw new Error("Result contains an unsafe evidence path");
  }
  return set;
}
async function requireFile(root: string, relative: string): Promise<string> {
  if (!safeRelative(relative))
    throw new Error("Result contains an unsafe evidence path");
  const absolute = path.join(root, relative);
  const stat = await lstat(absolute).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 100 * 1024 * 1024)
    throw new Error(`Required evidence is missing or unsafe: ${relative}`);
  return absolute;
}
async function requirePng(root: string, relative: string): Promise<void> {
  const absolute = await requireFile(root, relative);
  try {
    await inspectPng(absolute);
  } catch {
    throw new Error(`Required evidence is not a valid PNG: ${relative}`);
  }
}
async function requireEvidence(
  root: string,
  result: VisualResult,
): Promise<void> {
  const requiredReports =
    result.status === "infrastructure-error"
      ? [
          ".visual-regression/result/visual-summary.md",
          ".visual-regression/result/visual-report.html",
        ]
      : [
          ".visual-regression/result/visual-summary.md",
          ".visual-regression/result/visual-report.html",
          "playwright-report/visual/index.html",
        ];
  if (
    result.reportPaths.length !== requiredReports.length ||
    requiredReports.some((report) => !result.reportPaths.includes(report))
  )
    throw new Error("Result does not reference the complete required reports");
  for (const relative of requiredReports) await requireFile(root, relative);
  const evidencePaths = [
    ...result.changed,
    ...result.added,
    ...result.removed,
  ].flatMap((item) =>
    [item.expectedPath, item.actualPath, item.diffPath].filter(
      (relative): relative is string => Boolean(relative),
    ),
  );
  if (new Set(evidencePaths).size !== evidencePaths.length)
    throw new Error("Difference entries reuse an evidence path");
  for (const relative of evidencePaths) await requirePng(root, relative);
}
export async function validateWorkflowResult(options: GateOptions): Promise<{
  status: VisualResult["status"];
  conclusion: "success" | "advisory" | "failure";
}> {
  const file = path.join(
    options.root,
    ".visual-regression/result/visual-result.json",
  );
  const stat = await lstat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000)
    throw new VisualRegressionError(
      "RESULT_INVALID",
      "Result must be one bounded regular file",
    );
  const result: unknown = parseJsonWithoutDuplicateKeys(
    await readFile(file, "utf8"),
  );
  validateResult(result);
  if (
    result.operation !== options.operation ||
    result.candidateSha !== options.candidateSha
  )
    throw new VisualRegressionError(
      "RESULT_IDENTITY_MISMATCH",
      "Result operation or candidate SHA does not match trusted workflow state",
    );
  const completed = result.status !== "infrastructure-error";
  if (
    completed &&
    (result.visualContractHash !== options.contractHash ||
      result.runtime?.toolkitCommit !== toolkitRevision() ||
      result.runtime.playwrightVersion !== PLAYWRIGHT_VERSION ||
      result.runtime.chromiumRevision !== CHROMIUM_REVISION ||
      result.runtime.containerDigest !== CONTAINER_DIGEST ||
      result.runtime.os !== "linux" ||
      result.runtime.architecture !== "x64" ||
      result.runtime.platform !== "linux/amd64" ||
      !result.runtime.authoritative)
  )
    throw new VisualRegressionError(
      "RESULT_IDENTITY_MISMATCH",
      "Result contract or runtime identity does not match the toolkit commit on main",
    );
  if (
    options.operation === "compare" &&
    completed &&
    result.baselineSha !== options.baselineSha
  )
    throw new VisualRegressionError(
      "RESULT_IDENTITY_MISMATCH",
      "Result baseline SHA does not match the exact PR base SHA",
    );
  const changed = pairs(result.changed, "changed"),
    added = pairs(result.added, "added"),
    removed = pairs(result.removed, "removed");
  for (const key of changed)
    if (added.has(key) || removed.has(key))
      throw new Error("Result difference sets overlap");
  for (const key of added)
    if (removed.has(key)) throw new Error("Result difference sets overlap");
  if (
    result.status !== "infrastructure-error" &&
    (result.routeTotal < 1 ||
      result.screenshotTotal < result.routeTotal ||
      result.changed.length + result.added.length > result.screenshotTotal)
  )
    throw new Error("Result totals are inconsistent");
  const matrix =
    result.status === "pass" ? 0 : result.status === "visual-diff" ? 2 : 1;
  if (options.exitCode !== matrix)
    throw new VisualRegressionError(
      "RESULT_INVALID",
      "CLI exit code and result status do not agree",
    );
  await requireEvidence(options.root, result);
  const lines = [
    "## Visual regression",
    "",
    `**Status:** \`${result.status}\``,
    `**Candidate:** \`${result.candidateSha}\``,
  ];
  if (result.baselineSha) lines.push(`**Baseline:** \`${result.baselineSha}\``);
  lines.push(
    `**Screenshots:** ${String(result.screenshotTotal)}`,
    `**Changed / added / removed:** ${String(result.changed.length)} / ${String(result.added.length)} / ${String(result.removed.length)}`,
  );
  if (result.error)
    lines.push(
      "",
      `**${escape(result.error.code)}:** ${escape(result.error.message)}`,
    );
  lines.push(
    "",
    "Download the fixed visual evidence artifact for the HTML report and images.",
  );
  await writeFile(options.summaryPath, `${lines.join("  \n")}\n`, {
    mode: 0o600,
  });
  const conclusion =
    result.status === "visual-diff" && options.informational
      ? "advisory"
      : result.status === "pass"
        ? "success"
        : "failure";
  return { status: result.status, conclusion };
}
