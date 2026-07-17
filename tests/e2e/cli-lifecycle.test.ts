import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
const cli = path.resolve("src/cli/main.ts");
const tsxLoader = path.resolve("node_modules/tsx/dist/loader.mjs");
function run(root: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10_000_000,
    timeout: 120_000,
  });
}
describe("complete CLI lifecycle", () => {
  it("returns pass/0 for baseline and unchanged compare, then visual-diff/2", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-e2e-"));
    roots.push(root);
    const port = await availablePort();
    await writeFile(path.join(root, "content.txt"), "red");
    await writeFile(
      path.join(root, "build.mjs"),
      `import { mkdir, writeFile } from 'node:fs/promises'; await mkdir('.next',{recursive:true}); await writeFile('.next/prerender-manifest.json', JSON.stringify({version:4,routes:{'/':{}},dynamicRoutes:{},notFoundRoutes:[]}));`,
    );
    await writeFile(
      path.join(root, "server.mjs"),
      `import http from 'node:http'; import { readFile } from 'node:fs/promises'; http.createServer(async (_q,r)=>{const color=(await readFile('content.txt','utf8')).trim();r.setHeader('content-type','text/html');r.end('<!doctype html><style>html,body{margin:0;background:'+color+'}main{width:100vw;height:100vh}</style><main></main>')}).listen(${port},'127.0.0.1');`,
    );
    await writeFile(
      path.join(root, "visual-regression.config.ts"),
      `export default ${JSON.stringify({ framework: { type: "next-prerender" }, commands: { build: `"${process.execPath}" build.mjs`, start: `"${process.execPath}" server.mjs` }, server: { origin: `http://127.0.0.1:${port}`, startupTimeoutMs: 5000 }, projects: [{ name: "desktop", width: 160, height: 120 }], capture: { maxScrollPasses: 10 } })};`,
    );
    const common = [
      "--host",
      "--json",
      "--repository",
      "owner/repo",
      "--base-branch",
      "main",
    ];
    const baseline = run(root, [
      "baseline",
      "create",
      ...common,
      "--source-sha",
      "a".repeat(40),
    ]);
    expect(baseline.status, baseline.stderr).toBe(0);
    expect(JSON.parse(baseline.stdout).status).toBe("pass");
    const verified = run(root, [
      "baseline",
      "verify",
      ".visual-regression/baseline",
      "--json",
    ]);
    expect(verified.status, verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout).valid).toBe(true);
    const unchanged = run(root, [
      "compare",
      "--baseline",
      ".visual-regression/baseline",
      ...common,
      "--source-sha",
      "b".repeat(40),
      "--base-sha",
      "a".repeat(40),
    ]);
    expect(unchanged.status, unchanged.stderr).toBe(0);
    expect(JSON.parse(unchanged.stdout).status).toBe("pass");
    await writeFile(path.join(root, "content.txt"), "blue");
    const changed = run(root, [
      "compare",
      "--baseline",
      ".visual-regression/baseline",
      ...common,
      "--source-sha",
      "c".repeat(40),
      "--base-sha",
      "a".repeat(40),
    ]);
    expect(changed.status, changed.stderr).toBe(2);
    const result = JSON.parse(changed.stdout);
    expect(result.status).toBe("visual-diff");
    expect(result.changed).toHaveLength(1);
    expect(
      await readFile(
        path.join(root, ".visual-regression/result/visual-result.json"),
        "utf8",
      ),
    ).toContain('"visual-diff"');
  }, 120_000);
});
