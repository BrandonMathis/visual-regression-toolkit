import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { baseline, release, sha } from "../helpers.js";
import { verifyBaseline } from "../../src/baseline/verify.js";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function make(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-baseline-"));
  roots.push(root);
  await baseline(root);
  return root;
}
const compatibility = {
  consumerRepository: "owner/repo",
  sourceSha: sha,
  visualContractHash: "c".repeat(64),
  release,
};
describe("hostile-input baseline verification", () => {
  it("verifies a complete checksummed baseline and returns an indexed opaque value", async () => {
    const verified = await verifyBaseline(await make(), compatibility);
    expect(verified.index.size).toBe(1);
    expect(verified.manifest.sourceSha).toBe(sha);
  });
  it("rejects altered, missing, and extra screenshots", async () => {
    const altered = await make();
    await writeFile(
      path.join(altered, "screenshots/desktop/home.png"),
      "not png",
    );
    await expect(verifyBaseline(altered)).rejects.toThrow(
      /valid PNG|metadata mismatch/i,
    );
    const missing = await make();
    await rm(path.join(missing, "screenshots/desktop/home.png"));
    await expect(verifyBaseline(missing)).rejects.toThrow(/missing/i);
    const extra = await make();
    await writeFile(
      path.join(extra, "screenshots/desktop/extra.png"),
      await readFile(path.join(extra, "screenshots/desktop/home.png")),
    );
    await expect(verifyBaseline(extra)).rejects.toThrow(/extra/i);
  });
  it("rejects symlinks and incompatible identity with stable codes", async () => {
    const linked = await make();
    const image = path.join(linked, "screenshots/desktop/home.png");
    const target = path.join(linked, "target.png");
    await writeFile(target, await readFile(image));
    await rm(image);
    await symlink(target, image);
    await expect(verifyBaseline(linked)).rejects.toMatchObject({
      code: "BASELINE_CORRUPT",
    });
    const incompatible = await make();
    await expect(
      verifyBaseline(incompatible, {
        ...compatibility,
        sourceSha: "d".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "BASELINE_INCOMPATIBLE" });
    await expect(
      verifyBaseline(incompatible, {
        ...compatibility,
        release: { ...compatibility.release, os: "different-os" },
      }),
    ).rejects.toMatchObject({ code: "BASELINE_INCOMPATIBLE" });
    const changed = await make();
    await expect(
      verifyBaseline(changed, {
        ...compatibility,
        visualContractHash: "e".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "VISUAL_CONTRACT_CHANGED" });
  });
  it("rejects duplicate manifest keys", async () => {
    const root = await make();
    const file = path.join(root, "baseline-manifest.json");
    const manifest = await readFile(file, "utf8");
    await writeFile(
      file,
      manifest.replace(
        '"schemaVersion": 1,',
        '"schemaVersion": 1, "schemaVersion": 1,',
      ),
    );
    await expect(verifyBaseline(root)).rejects.toMatchObject({
      code: "BASELINE_CORRUPT",
    });
  });
  it("rejects manifest traversal before touching outside files", async () => {
    const root = await make();
    const file = path.join(root, "baseline-manifest.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.routes[0].fileName = "../escape.png";
    manifest.screenshots[0].path = "screenshots/desktop/../escape.png";
    await writeFile(file, JSON.stringify(manifest));
    await expect(verifyBaseline(root)).rejects.toMatchObject({
      code: "BASELINE_CORRUPT",
    });
  });
});
