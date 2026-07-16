import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { isVisualRegressionError } from '../../src/errors.js';
import type { ErrorCode } from '../../src/errors.js';
import { DEFAULT_PROJECTS } from '../../src/types.js';
import type { ResolvedVisualConfig } from '../../src/types.js';

/** Builds a fully-resolved config by hand so discovery tests do not depend on src/config. */
export function makeResolvedConfig(
  repoRoot: string,
  overrides: {
    manifestPath?: string;
    routes?: Partial<ResolvedVisualConfig['routes']>;
  } = {},
): ResolvedVisualConfig {
  return {
    repoRoot,
    configPath: join(repoRoot, 'visual-regression.config.ts'),
    framework: {
      type: 'next-prerender',
      manifestPath: overrides.manifestPath ?? join(repoRoot, '.next/prerender-manifest.json'),
    },
    commands: { build: 'npm run build', start: 'npm run start' },
    server: { origin: 'http://127.0.0.1:3111', readinessPath: '/', startupTimeoutMs: 120_000 },
    routes: {
      include: overrides.routes?.include ?? ['/**'],
      exclude: overrides.routes?.exclude ?? [],
      additional: overrides.routes?.additional ?? [],
    },
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
      screenshot: { fullPage: true, threshold: 0.2 },
    },
  };
}

/** One prerendered-HTML route entry shaped like a real Next 16 app-router manifest entry. */
export function manifestRouteEntry(route: string): Record<string, unknown> {
  return {
    initialRevalidateSeconds: false,
    srcRoute: route,
    dataRoute: `${route === '/' ? '/index' : route}.rsc`,
    experimentalBypassFor: [],
    allowHeader: ['host', 'x-matched-path', 'x-prerender-revalidate'],
  };
}

export function syntheticManifest(
  routes: string[],
  extra: { version?: number; dynamicRoutes?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    version: extra.version ?? 4,
    routes: Object.fromEntries(routes.map((route) => [route, manifestRouteEntry(route)])),
    dynamicRoutes: extra.dynamicRoutes ?? {},
    notFoundRoutes: [],
    preview: {
      previewModeId: 'fixture',
      previewModeSigningKey: 'fixture',
      previewModeEncryptionKey: 'fixture',
    },
  };
}

/** Creates a temp repo root containing .next/prerender-manifest.json with the given content. */
export async function makeManifestDir(content: string | Record<string, unknown>): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'vr-discovery-'));
  const raw = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await mkdir(join(repoRoot, '.next'), { recursive: true });
  await writeFile(join(repoRoot, '.next', 'prerender-manifest.json'), raw, 'utf8');
  return repoRoot;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function expectErrorCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  const outcome = await promise.then(
    (value) => ({ resolved: true as const, value }),
    (error: unknown) => ({ resolved: false as const, error }),
  );
  expect(outcome.resolved, `expected rejection with ${code}, but the promise resolved`).toBe(false);
  if (outcome.resolved) return;
  const { error } = outcome;
  expect(
    isVisualRegressionError(error),
    `expected VisualRegressionError, got: ${String(error)}`,
  ).toBe(true);
  if (isVisualRegressionError(error)) {
    expect(error.code).toBe(code);
  }
}
