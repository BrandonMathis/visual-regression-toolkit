import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../../src/config/index.js";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
describe("TypeScript config loading", () => {
  it("loads only the explicit repository-relative plain default export", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-config-"));
    roots.push(root);
    await writeFile(
      path.join(root, "custom.config.ts"),
      `export default { framework: { type: 'next-prerender' }, commands: { build: 'true', start: 'true' }, server: { origin: 'http://127.0.0.1:3210' } };`,
    );
    const loaded = await readConfig(root, "custom.config.ts");
    expect(loaded.config.server.origin).toBe("http://127.0.0.1:3210");
    expect(loaded.hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(readConfig(root, "../outside.ts")).rejects.toThrow(/unsafe/i);
  });
  it("rejects a non-plain default export", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-config-"));
    roots.push(root);
    await writeFile(
      path.join(root, "visual-regression.config.ts"),
      `export default new (class Config {})();`,
    );
    await expect(readConfig(root)).rejects.toThrow(/plain object/i);
  });
});
