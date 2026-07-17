import type {
  Difference,
  ReleaseIdentity,
  VisualResult,
} from "../contracts/types.js";
export type ResultInput = {
  operation: "baseline-create" | "compare";
  status: "pass" | "visual-diff";
  candidateSha: string;
  baselineSha?: string;
  visualContractHash: string;
  runtime: ReleaseIdentity;
  routeTotal: number;
  screenshotTotal: number;
  changed?: Difference[];
  added?: Difference[];
  removed?: Difference[];
};
export function completedResult(input: ResultInput): VisualResult {
  const evidence = {
    schemaVersion: 1 as const,
    candidateSha: input.candidateSha,
    visualContractHash: input.visualContractHash,
    runtime: input.runtime,
    routeTotal: input.routeTotal,
    screenshotTotal: input.screenshotTotal,
    changed: input.changed ?? [],
    added: input.added ?? [],
    removed: input.removed ?? [],
    reportPaths: [
      ".visual-regression/result/visual-summary.md",
      ".visual-regression/result/visual-report.html",
      "playwright-report/visual/index.html",
    ],
  };
  if (input.operation === "baseline-create") {
    if (input.status !== "pass")
      throw new Error("baseline-create cannot produce a visual difference");
    return { ...evidence, operation: "baseline-create", status: "pass" };
  }
  if (!input.baselineSha)
    throw new Error("A completed comparison requires a baseline SHA");
  if (input.status === "visual-diff") {
    if (
      evidence.changed.length === 0 &&
      evidence.added.length === 0 &&
      evidence.removed.length === 0
    )
      throw new Error(
        "A visual difference requires complete difference evidence",
      );
    return {
      ...evidence,
      operation: "compare",
      status: "visual-diff",
      baselineSha: input.baselineSha,
    };
  }
  return {
    ...evidence,
    operation: "compare",
    status: "pass",
    baselineSha: input.baselineSha,
  };
}
export function errorResult(
  operation: "baseline-create" | "compare",
  candidateSha: string,
  error: { code: string; message: string; retryable: boolean },
): VisualResult {
  return {
    schemaVersion: 1,
    operation,
    status: "infrastructure-error",
    candidateSha,
    routeTotal: 0,
    screenshotTotal: 0,
    changed: [],
    added: [],
    removed: [],
    error: {
      code: error.code,
      message: error.message.slice(0, 2048),
      retryable: error.retryable,
    },
    reportPaths: [
      ".visual-regression/result/visual-summary.md",
      ".visual-regression/result/visual-report.html",
    ],
  };
}
