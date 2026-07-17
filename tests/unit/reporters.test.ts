import { describe, expect, it } from "vitest";
import { html, markdown } from "../../src/reporters/render.js";
import { completedResult } from "../../src/result/builder.js";
import { release, sha } from "../helpers.js";
describe("bounded escaped reports", () => {
  it("escapes hostile route text in Markdown and HTML", () => {
    const result = completedResult({
      operation: "compare",
      status: "visual-diff",
      candidateSha: sha,
      baselineSha: sha,
      visualContractHash: "c".repeat(64),
      runtime: release,
      routeTotal: 1,
      screenshotTotal: 1,
      changed: [{ route: "/<script>alert(1)</script>|x", project: "desktop" }],
    });
    expect(markdown(result)).not.toContain("<script>");
    expect(markdown(result)).toContain("&lt;script&gt;");
    expect(html(result)).not.toContain("<script>alert(1)</script>");
    expect(html(result)).toContain("&lt;script&gt;");
  });
  it("caps rendered difference rows", () => {
    const changed = Array.from({ length: 600 }, (_, index) => ({
      route: `/route-${String(index)}`,
      project: "desktop",
    }));
    const result = completedResult({
      operation: "compare",
      status: "visual-diff",
      candidateSha: sha,
      baselineSha: sha,
      visualContractHash: "c".repeat(64),
      runtime: release,
      routeTotal: 600,
      screenshotTotal: 600,
      changed,
    });
    expect(markdown(result)).toContain("truncated");
    expect((html(result).match(/<tr>/g) ?? []).length).toBe(501);
  });
});
