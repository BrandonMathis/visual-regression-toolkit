import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type {
  BaselineManifest,
  ComparisonEntry,
  ResolvedVisualConfig,
  RouteDescriptor,
  VisualResult,
} from '../../../src/types.js';
import { DEFAULT_PROJECTS } from '../../../src/types.js';

export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'vr-result-'));
}

export type Rgba = [number, number, number, number?];

export function solidPng(width: number, height: number, [r, g, b, a = 255]: Rgba): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = a;
  }
  return png;
}

export function setPixel(png: PNG, x: number, y: number, [r, g, b, a = 255]: Rgba): void {
  const i = (y * png.width + x) * 4;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = a;
}

export function pixelAt(png: PNG, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i] ?? -1, png.data[i + 1] ?? -1, png.data[i + 2] ?? -1, png.data[i + 3] ?? -1];
}

export async function writePngFile(absPath: string, png: PNG): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, PNG.sync.write(png));
}

export function makeConfig(repoRoot: string, threshold = 0.2): ResolvedVisualConfig {
  return {
    repoRoot,
    configPath: path.join(repoRoot, 'visual-regression.config.ts'),
    framework: {
      type: 'next-prerender',
      manifestPath: path.join(repoRoot, '.next/prerender-manifest.json'),
    },
    commands: { build: 'npm run build', start: 'npm run start' },
    server: { origin: 'http://127.0.0.1:3000', readinessPath: '/', startupTimeoutMs: 120_000 },
    routes: { include: ['/**'], exclude: [], additional: [] },
    clock: { environmentVariable: 'VISUAL_TEST_DATE' },
    projects: DEFAULT_PROJECTS,
    capture: {
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
      fontChecks: [],
      readinessSelectors: [],
      masks: [],
      externalRequests: { default: 'block', allow: ['self', 'data:', 'blob:'] },
      screenshot: { fullPage: true, threshold },
    },
  };
}

export interface ManifestScreenshot {
  project: string;
  route: string;
  name: string;
  width?: number;
  height?: number;
}

export function makeManifest(
  routes: RouteDescriptor[],
  screenshots: ManifestScreenshot[],
): BaselineManifest {
  return {
    schemaVersion: 1,
    repository: 'thisdot/example',
    baseBranch: 'main',
    sourceSha: 'a'.repeat(40),
    workflowRunId: '123',
    workflowRunAttempt: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    logicalDate: '2026-07-16',
    toolkit: { name: '@thisdot/visual-regression', version: '1.0.0' },
    playwrightVersion: '1.61.1',
    chromiumRevision: '1228',
    environment: {
      os: 'linux',
      arch: 'x64',
      containerDigest: 'sha256:abc',
      platform: 'linux/amd64',
    },
    visualContractHash: 'contract-hash',
    adapter: { type: 'next-prerender', behaviorVersion: 1 },
    projects: DEFAULT_PROJECTS,
    routes,
    screenshots: screenshots.map((shot) => ({
      project: shot.project,
      route: shot.route,
      path: `screenshots/${shot.project}/${shot.name}`,
      width: shot.width ?? 4,
      height: shot.height ?? 4,
      bytes: 100,
      sha256: '0'.repeat(64),
    })),
  };
}

export function makeEntry(overrides: Partial<ComparisonEntry> = {}): ComparisonEntry {
  return {
    project: 'desktop',
    route: '/',
    screenshotName: 'home.png',
    status: 'unchanged',
    expectedPath: '.visual-regression/baseline/screenshots/desktop/home.png',
    actualPath: '.visual-regression/candidate/screenshots/desktop/home.png',
    diffPath: null,
    diffPixelRatio: 0,
    ...overrides,
  };
}

export function makeResult(overrides: Partial<VisualResult> = {}): VisualResult {
  return {
    schemaVersion: 1,
    operation: 'compare',
    status: 'pass',
    createdAt: '2026-07-16T00:00:00.000Z',
    candidateSha: 'b'.repeat(40),
    baseline: {
      sourceSha: 'a'.repeat(40),
      visualContractHash: 'contract-hash',
      toolkitVersion: '1.0.0',
      playwrightVersion: '1.61.1',
      chromiumRevision: '1228',
      containerDigest: 'sha256:abc',
      platform: 'linux/amd64',
    },
    visualContractHash: 'contract-hash',
    runtime: {
      toolkitVersion: '1.0.0',
      playwrightVersion: '1.61.1',
      chromiumRevision: '1228',
      os: 'linux',
      arch: 'x64',
      host: false,
    },
    totals: { routes: 1, screenshots: 1, changed: 0, added: 0, removed: 0 },
    comparisons: [makeEntry()],
    errors: [],
    reports: {
      html: null,
      json: '.visual-regression/result/visual-result.json',
      markdown: '.visual-regression/result/visual-summary.md',
    },
    ...overrides,
  };
}
