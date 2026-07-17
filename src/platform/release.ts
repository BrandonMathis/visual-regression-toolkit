import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { ReleaseIdentity } from "../contracts/types.js";
export const PLAYWRIGHT_VERSION = "1.61.1";
export const CHROMIUM_REVISION = "1228";
export const CONTAINER_DIGEST =
  "sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6";
export const CONTAINER_IMAGE = `mcr.microsoft.com/playwright:v1.61.1-noble@${CONTAINER_DIGEST}`;
const commit = /^(?!0{40}$)[a-f0-9]{40}$/;
const uncommittedRevision = "0".repeat(40);
export function toolkitRevision(): string {
  const injected = process.env.VISUAL_REGRESSION_TOOLKIT_COMMIT;
  if (injected) {
    if (!commit.test(injected))
      throw new Error(
        "VISUAL_REGRESSION_TOOLKIT_COMMIT must be a full lowercase Git commit",
      );
    return injected;
  }
  try {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return commit.test(revision) ? revision : uncommittedRevision;
  } catch {
    return uncommittedRevision;
  }
}
export async function releaseIdentity(
  authoritative: boolean,
): Promise<ReleaseIdentity> {
  const toolkitCommit = toolkitRevision();
  if (authoritative && toolkitCommit === uncommittedRevision)
    throw new Error(
      "Authoritative execution requires VISUAL_REGRESSION_TOOLKIT_COMMIT",
    );
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("playwright-core/package.json");
  const browsers = JSON.parse(
    await readFile(
      path.join(path.dirname(packagePath), "browsers.json"),
      "utf8",
    ),
  ) as { browsers: Array<{ name: string; revision: string }> };
  const chromiumRevision = browsers.browsers.find(
    (browser) => browser.name === "chromium",
  )?.revision;
  if (!chromiumRevision || chromiumRevision !== CHROMIUM_REVISION)
    throw new Error("Playwright Chromium revision does not match this release");
  return {
    toolkitCommit,
    schemaVersion: 1,
    playwrightVersion: PLAYWRIGHT_VERSION,
    chromiumRevision,
    containerDigest: CONTAINER_DIGEST,
    os: authoritative ? "linux" : os.platform(),
    architecture: authoritative ? "x64" : os.arch(),
    platform: authoritative ? "linux/amd64" : `${os.platform()}/${os.arch()}`,
    authoritative,
  };
}
