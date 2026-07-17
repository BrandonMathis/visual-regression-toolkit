import { describe, expect, it } from "vitest";
import {
  validateConfigShape,
  validateResult,
} from "../../src/contracts/validate.js";
import { completedResult, errorResult } from "../../src/result/builder.js";
import { rawConfig, release, sha } from "../helpers.js";

describe("strict schemas", () => {
  it("accepts a valid config and rejects nested unknown fields", () => {
    expect(() => validateConfigShape(rawConfig)).not.toThrow();
    expect(() =>
      validateConfigShape({
        ...rawConfig,
        server: { ...rawConfig.server, secret: "no" },
      }),
    ).toThrow(/additional properties/i);
  });
  it("accepts each legal result family", () => {
    const base = {
      candidateSha: sha,
      visualContractHash: "c".repeat(64),
      runtime: release,
      routeTotal: 1,
      screenshotTotal: 1,
    };
    expect(() =>
      validateResult(
        completedResult({
          operation: "baseline-create",
          status: "pass",
          ...base,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateResult(
        completedResult({
          operation: "compare",
          status: "pass",
          baselineSha: sha,
          ...base,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateResult(
        completedResult({
          operation: "compare",
          status: "visual-diff",
          baselineSha: sha,
          ...base,
          changed: [{ route: "/", project: "desktop" }],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateResult(
        errorResult("compare", sha, {
          code: "BUILD_FAILED",
          message: "failed",
          retryable: false,
        }),
      ),
    ).not.toThrow();
  });
  it("rejects illegal operation/status and payload combinations", () => {
    const invalid = {
      schemaVersion: 1,
      operation: "baseline-create",
      status: "visual-diff",
      candidateSha: sha,
      routeTotal: 1,
      screenshotTotal: 1,
      changed: [{ route: "/", project: "desktop" }],
      added: [],
      removed: [],
      reportPaths: [],
    };
    expect(() => validateResult(invalid)).toThrow();
    expect(() =>
      validateResult({ ...invalid, operation: "compare", changed: [] }),
    ).toThrow();
    const passWithDiff = { ...invalid, operation: "compare", status: "pass" };
    expect(() => validateResult(passWithDiff)).toThrow();
  });
});
