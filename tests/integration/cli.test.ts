import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
const cli = path.resolve("src/cli/main.ts");
const tsxLoader = path.resolve("node_modules/tsx/dist/loader.mjs");
function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], {
    cwd,
    encoding: "utf8",
  });
}
describe("CLI controller", () => {
  it("prints command help on stdout", () => {
    const result = run(process.cwd(), ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("baseline create");
    expect(result.stdout).toContain("compare --baseline");
  });
  it("writes bounded JSON infrastructure results and exits 1 for setup errors", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "visual-cli-"));
    roots.push(cwd);
    const result = run(cwd, ["compare", "--json", "--host"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      operation: "compare",
      status: "infrastructure-error",
      error: { code: "CONFIG_INVALID" },
    });
    const disk = JSON.parse(
      await readFile(
        path.join(cwd, ".visual-regression/result/visual-result.json"),
        "utf8",
      ),
    );
    expect(disk.status).toBe("infrastructure-error");
    expect(result.stderr).not.toContain("at ");
  });
});
