import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runCommand,
  spawnCommand,
  stopProcess,
} from "../../src/process/command.js";
import { startServer } from "../../src/process/server.js";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
describe("build and server lifecycle", () => {
  it("classifies nonzero and timed-out builds", async () => {
    await expect(
      runCommand(
        `"${process.execPath}" -e "process.exit(7)"`,
        process.cwd(),
        process.env,
      ),
    ).rejects.toMatchObject({ code: "BUILD_FAILED" });
    await expect(
      runCommand(
        `"${process.execPath}" -e "setTimeout(() => {}, 10000)"`,
        process.cwd(),
        process.env,
        100,
      ),
    ).rejects.toMatchObject({ code: "BUILD_FAILED", retryable: true });
  });
  it("waits for readiness and reliably stops the process group", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-server-"));
    roots.push(root);
    const selected = await port();
    await writeFile(
      path.join(root, "server.mjs"),
      `import http from 'node:http'; const server=http.createServer((_q,r)=>{r.end('ready')}); server.listen(${selected},'127.0.0.1');`,
    );
    const running = await startServer(
      `"${process.execPath}" server.mjs`,
      root,
      process.env,
      `http://127.0.0.1:${selected}/`,
      5000,
    );
    expect((await fetch(`http://127.0.0.1:${selected}/`)).status).toBe(200);
    await running.stop();
    await expect(
      fetch(`http://127.0.0.1:${selected}/`, {
        signal: AbortSignal.timeout(500),
      }),
    ).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")(
    "kills descendants after the process-group leader has already exited",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "visual-orphan-"));
      roots.push(root);
      await writeFile(
        path.join(root, "descendant.mjs"),
        `import { writeFileSync } from 'node:fs'; writeFileSync('descendant.pid', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
      );
      await writeFile(
        path.join(root, "leader.mjs"),
        `import { spawn } from 'node:child_process'; spawn(process.execPath, ['descendant.mjs'], { stdio: 'ignore' }).unref();`,
      );
      const leader = spawnCommand(
        `"${process.execPath}" leader.mjs`,
        root,
        process.env,
        true,
      );
      await new Promise<void>((resolve, reject) => {
        leader.once("error", reject);
        leader.once("exit", () => resolve());
      });
      let descendantPid = 0;
      for (let attempt = 0; attempt < 20 && !descendantPid; attempt++) {
        descendantPid = Number(
          await readFile(path.join(root, "descendant.pid"), "utf8").catch(
            () => "0",
          ),
        );
        if (!descendantPid)
          await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(descendantPid).toBeGreaterThan(0);
      await stopProcess(leader);
      expect(() => process.kill(descendantPid, 0)).toThrow();
    },
    10_000,
  );
  it("rejects an occupied readiness URL rather than accepting another server", async () => {
    const selected = await port();
    const occupied = createHttpServer((_request, response) => {
      response.end("ready");
    });
    await new Promise<void>((resolve, reject) =>
      occupied.listen(selected, "127.0.0.1", resolve).once("error", reject),
    );
    try {
      await expect(
        startServer(
          "true",
          process.cwd(),
          process.env,
          `http://127.0.0.1:${selected}/`,
          500,
        ),
      ).rejects.toMatchObject({ code: "SERVER_FAILED" });
    } finally {
      occupied.closeAllConnections();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });
});
