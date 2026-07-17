import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import type {
  BaselineManifest,
  CaptureRecord,
  NormalizedConfig,
  ReleaseIdentity,
} from "../src/contracts/types.js";
import { inspectPng } from "../src/baseline/checksum.js";
import { createManifest } from "../src/baseline/create-manifest.js";
import { routeFileName } from "../src/discovery/route-name.js";

export const sha = "a".repeat(40);
export const digest = `sha256:${"b".repeat(64)}`;
export const release: ReleaseIdentity = {
  toolkitCommit: "f".repeat(40),
  schemaVersion: 1,
  playwrightVersion: "1.61.1",
  chromiumRevision: "1234",
  containerDigest: digest,
  os: "darwin",
  architecture: "arm64",
  platform: "darwin/arm64",
  authoritative: false,
};
export const rawConfig = {
  framework: { type: "next-prerender" as const },
  commands: { build: "npm run build", start: "npm start" },
  server: { origin: "http://127.0.0.1:3000" },
};
export async function png(
  file: string,
  pixels: number[] = [255, 0, 0, 255],
): Promise<CaptureRecord> {
  await mkdir(path.dirname(file), { recursive: true });
  const image = new PNG({ width: 1, height: 1 });
  image.data.set(pixels);
  await writeFile(file, PNG.sync.write(image));
  const details = await inspectPng(file);
  return {
    route: "/",
    project: "desktop",
    path: "screenshots/desktop/home.png",
    absolutePath: file,
    ...details,
  };
}
export async function baseline(root: string): Promise<BaselineManifest> {
  const record = await png(path.join(root, "screenshots/desktop/home.png"));
  return createManifest(root, {
    consumerRepository: "owner/repo",
    baseBranch: "main",
    sourceSha: sha,
    workflowRunId: "12345678901234567890",
    workflowRunAttempt: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    logicalDate: "2026-07-16T00:00:00.000Z",
    release,
    visualContractHash: "c".repeat(64),
    projects: [
      {
        name: "desktop",
        width: 100,
        height: 100,
        hasTouch: false,
        isMobile: false,
        deviceScaleFactor: 1,
      },
    ],
    routes: [{ route: "/", fileName: routeFileName("/") }],
    records: [record],
  });
}
export function normalized(
  overrides: Partial<NormalizedConfig> = {},
): NormalizedConfig {
  return {
    framework: {
      type: "next-prerender",
      manifestPath: ".next/prerender-manifest.json",
    },
    commands: { build: "npm run build", start: "npm start" },
    server: {
      origin: "http://127.0.0.1:3000",
      readinessPath: "/",
      startupTimeoutMs: 120000,
    },
    routes: { include: ["/**"], exclude: [], additional: [] },
    clock: { environmentVariable: "VISUAL_TEST_DATE" },
    projects: [
      {
        name: "desktop",
        width: 1440,
        height: 900,
        hasTouch: false,
        isMobile: false,
        deviceScaleFactor: 1,
      },
    ],
    capture: {
      colorScheme: "light",
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      fontChecks: [],
      readinessSelectors: [],
      masks: [],
      externalRequests: { default: "block", allow: ["blob:", "data:", "self"] },
      screenshot: { fullPage: true, threshold: 0.2 },
      navigationTimeoutMs: 30000,
      stabilizationTimeoutMs: 30000,
      maxScrollPasses: 100,
      maxDocumentHeight: 50000,
      maxResources: 1000,
    },
    ...overrides,
  };
}
