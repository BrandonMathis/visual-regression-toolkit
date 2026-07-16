import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { expect } from 'vitest';
import type { CreateBaselineOptions } from '../../../src/baseline/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { MANIFEST_NAME } from '../../../src/paths.js';
import type { BaselineManifest, ResolvedProject, RouteDescriptor } from '../../../src/types.js';

export const TEST_PROJECTS: ResolvedProject[] = [
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  { name: 'phone', width: 375, height: 812, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
];

export const TEST_ROUTES: RouteDescriptor[] = [
  { route: '/', screenshotName: 'home.png' },
  { route: '/about', screenshotName: 'about.png' },
];

export const TEST_IDENTITY = {
  repository: 'thisdot/example-site',
  baseBranch: 'main',
  sourceSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  workflowRunId: '123456789',
  workflowRunAttempt: 1,
  createdAt: '2026-07-16T12:00:00.000Z',
  logicalDate: '2026-07-01',
};

export const TEST_ENVIRONMENT = {
  os: 'linux',
  arch: 'x64',
  containerDigest: `sha256:${'0'.repeat(64)}`,
  platform: 'linux/amd64',
};

export const TEST_CONTRACT_HASH = 'f'.repeat(64);

export const PNG_WIDTH = 8;
export const PNG_HEIGHT = 6;

export function makePng(width: number, height: number, seed: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i / 4 + seed) % 256;
    png.data[i + 1] = (seed * 31) % 256;
    png.data[i + 2] = 128;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

const createdDirs: string[] = [];

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
}

export interface BaselineFixture {
  dir: string;
  screenshotsDir: string;
  baselineDir: string;
  options: CreateBaselineOptions;
}

/** Writes one distinct real PNG per route/project pair into the capture layout. */
export async function makeBaselineFixture(): Promise<BaselineFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'vr-baseline-'));
  createdDirs.push(dir);
  const screenshotsDir = join(dir, 'captured');
  const baselineDir = join(dir, 'baseline');
  let seed = 1;
  for (const project of TEST_PROJECTS) {
    for (const route of TEST_ROUTES) {
      const filePath = join(screenshotsDir, project.name, route.screenshotName);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, makePng(PNG_WIDTH, PNG_HEIGHT, seed));
      seed += 1;
    }
  }
  const options: CreateBaselineOptions = {
    screenshotsDir,
    baselineDir,
    routes: TEST_ROUTES.map((route) => ({ ...route })),
    projects: TEST_PROJECTS.map((project) => ({ ...project })),
    identity: { ...TEST_IDENTITY },
    environment: { ...TEST_ENVIRONMENT },
    visualContractHash: TEST_CONTRACT_HASH,
  };
  return { dir, screenshotsDir, baselineDir, options };
}

export async function editManifest(
  baselineDir: string,
  mutate: (manifest: BaselineManifest) => void,
): Promise<void> {
  const manifestPath = join(baselineDir, MANIFEST_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BaselineManifest;
  mutate(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function expectVisualError(
  promise: Promise<unknown>,
  code: string,
): Promise<VisualRegressionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VisualRegressionError);
    const visualError = error as VisualRegressionError;
    expect(visualError.code).toBe(code);
    return visualError;
  }
  throw new Error(`expected rejection with code ${code}, but the promise resolved`);
}
