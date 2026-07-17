import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverRoutes } from "../../src/discovery/next-prerender.js";
import { normalized } from "../helpers.js";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function fixture(manifest: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-routes-"));
  roots.push(root);
  await mkdir(path.join(root, ".next"));
  await writeFile(
    path.join(root, ".next/prerender-manifest.json"),
    JSON.stringify(manifest),
  );
  return root;
}
describe("Next prerender route discovery", () => {
  it("selects actual routes, filters internals and metadata, then sorts additions", async () => {
    const root = await fixture({
      version: 4,
      routes: {
        "/": {},
        "/about": {},
        "/_not-found": {},
        "/robots.txt": {},
        "/skip/me": {},
      },
      dynamicRoutes: { "/post/[slug]": {} },
      notFoundRoutes: [],
    });
    const config = normalized({
      routes: {
        include: ["/**"],
        exclude: ["/skip/**"],
        additional: ["/z", "/about"],
      },
    });
    const routes = await discoverRoutes(root, config);
    expect(routes.map((item) => item.route)).toEqual(["/", "/about", "/z"]);
  });
  it("fails closed for unknown versions, unresolved additions, and empty sets", async () => {
    await expect(
      discoverRoutes(
        await fixture({ version: 99, routes: { "/": {} } }),
        normalized(),
      ),
    ).rejects.toThrow(/unsupported/i);
    await expect(
      discoverRoutes(await fixture({ version: 4, routes: {} }), normalized()),
    ).rejects.toThrow(/no routes/i);
    await expect(
      discoverRoutes(
        await fixture({ version: 4, routes: { "/[slug]": {} } }),
        normalized(),
      ),
    ).rejects.toThrow(/unresolved/i);
    await expect(
      discoverRoutes(
        await fixture({ version: 4, routes: { "/": null } }),
        normalized(),
      ),
    ).rejects.toThrow(/shape/i);
    await expect(
      discoverRoutes(
        await fixture({ version: 4, routes: { "//evil.test": {} } }),
        normalized(),
      ),
    ).rejects.toThrow(/unsafe/i);
    await expect(
      discoverRoutes(
        await fixture({
          version: 4,
          routes: { "/": { unknown: true } },
          notFoundRoutes: [{}],
        }),
        normalized(),
      ),
    ).rejects.toThrow(/shape/i);
  });
});
