import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeConfig } from "../../src/config/normalize.js";
import { runCaptureSuite } from "../../src/capture/run-suite.js";
import { rawConfig } from "../helpers.js";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
describe("isolated generated Playwright capture", () => {
  it("leaves consumer Playwright config untouched and produces byte-identical clean captures", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(
        `<!doctype html><style>*{animation: pulse 1s infinite}@keyframes pulse{to{opacity:.5}}</style><h1>Stable page</h1><img loading="lazy" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='red'/%3E%3C/svg%3E">`,
      );
    });
    await new Promise<void>((resolve, reject) =>
      server.listen(0, "127.0.0.1", resolve).once("error", reject),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server address");
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-capture-"));
    roots.push(root);
    const sentinel = "throw new Error('functional config must not be read');\n";
    await writeFile(path.join(root, "playwright.config.ts"), sentinel);
    const config = normalizeConfig({
      ...rawConfig,
      server: { origin: `http://127.0.0.1:${address.port}` },
      projects: [{ name: "desktop", width: 320, height: 240 }],
      capture: { maxScrollPasses: 10 },
    });
    try {
      const routes = [{ route: "/", fileName: "home.png" }];
      const first = await runCaptureSuite(
        root,
        config,
        routes,
        path.join(root, "first"),
        "2026-07-16T00:00:00.000Z",
      );
      const second = await runCaptureSuite(
        root,
        config,
        routes,
        path.join(root, "second"),
        "2026-07-16T00:00:00.000Z",
      );
      expect(await readFile(first[0]!.absolutePath)).toEqual(
        await readFile(second[0]!.absolutePath),
      );
      expect(
        await readFile(path.join(root, "playwright.config.ts"), "utf8"),
      ).toBe(sentinel);
      expect(
        await readFile(
          path.join(root, ".visual-regression/generated/playwright.config.mjs"),
          "utf8",
        ),
      ).toContain("capture.spec.mjs");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
