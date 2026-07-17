import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { baseline, png } from "../helpers.js";
import { verifyBaseline } from "../../src/baseline/verify.js";
import { compareCaptures } from "../../src/compare/run-comparison.js";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function root(prefix: string): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(value);
  return value;
}
describe("decoded pixel comparison", () => {
  it("passes identical pixels despite independent files and detects changed pixels", async () => {
    const expectedRoot = await root("visual-expected-");
    await baseline(expectedRoot);
    const verified = await verifyBaseline(expectedRoot);
    const candidateRoot = await root("visual-candidate-");
    const same = await png(path.join(candidateRoot, "same.png"));
    expect(
      await compareCaptures(
        verified,
        [same],
        path.join(candidateRoot, "result"),
        0.2,
      ),
    ).toEqual({ changed: [], added: [], removed: [] });
    const changed = await png(
      path.join(candidateRoot, "changed.png"),
      [0, 0, 255, 255],
    );
    const result = await compareCaptures(
      verified,
      [changed],
      path.join(candidateRoot, "result2"),
      0.2,
    );
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]?.differingPixels).toBe(1);
  });
  it("classifies complete candidate-only and baseline-only pairs", async () => {
    const expectedRoot = await root("visual-expected-");
    await baseline(expectedRoot);
    const verified = await verifyBaseline(expectedRoot);
    const candidateRoot = await root("visual-candidate-");
    const added = await png(path.join(candidateRoot, "added.png"));
    added.route = "/new";
    added.path = "screenshots/desktop/new.png";
    const result = await compareCaptures(
      verified,
      [added],
      path.join(candidateRoot, "result"),
      0.2,
    );
    expect(result.added.map((item) => item.route)).toEqual(["/new"]);
    expect(result.removed.map((item) => item.route)).toEqual(["/"]);
  });
  it("treats undecodable candidate PNGs as infrastructure failures", async () => {
    const expectedRoot = await root("visual-expected-");
    await baseline(expectedRoot);
    const verified = await verifyBaseline(expectedRoot);
    const candidateRoot = await root("visual-candidate-");
    const record = await png(path.join(candidateRoot, "candidate.png"));
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(record.absolutePath, "broken"),
    );
    await expect(
      compareCaptures(
        verified,
        [record],
        path.join(candidateRoot, "result"),
        0.2,
      ),
    ).rejects.toMatchObject({ code: "CAPTURE_FAILED" });
  });
});
