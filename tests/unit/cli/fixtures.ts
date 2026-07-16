import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import {
  BASELINE_MANIFEST_SCHEMA_VERSION,
  CHROMIUM_REVISION,
  CONTAINER_DIGEST,
  CONTAINER_PLATFORM,
  PLAYWRIGHT_VERSION,
  TOOLKIT_NAME,
} from '../../../src/runtime.js';
import type { BaselineManifest, ResolvedVisualConfig } from '../../../src/types.js';
import { DEFAULT_PROJECTS } from '../../../src/types.js';

export const FULL_SHA = 'a'.repeat(40);
export const CONTRACT_HASH = 'hash123';

/** Creates a temp dir and makes it the CLI's repo root (process.cwd()). */
export async function makeRepoRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vr-cli-'));
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  return dir;
}

export function stubGitHubEnv(): void {
  vi.stubEnv('GITHUB_REPOSITORY', 'acme/site');
  vi.stubEnv('GITHUB_REF_NAME', 'main');
  vi.stubEnv('GITHUB_SHA', FULL_SHA);
  vi.stubEnv('GITHUB_RUN_ID', '4242');
  vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
}

export function makeConfig(repoRoot: string): ResolvedVisualConfig {
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
      screenshot: { fullPage: true, threshold: 0.2 },
    },
  };
}

export function makeManifest(overrides: Partial<BaselineManifest> = {}): BaselineManifest {
  return {
    schemaVersion: BASELINE_MANIFEST_SCHEMA_VERSION,
    repository: 'acme/site',
    baseBranch: 'main',
    sourceSha: FULL_SHA,
    workflowRunId: '4242',
    workflowRunAttempt: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    logicalDate: '2026-01-01T00:00:00.000Z',
    toolkit: { name: TOOLKIT_NAME, version: '1.0.0' },
    playwrightVersion: PLAYWRIGHT_VERSION,
    chromiumRevision: CHROMIUM_REVISION,
    environment: {
      os: 'linux',
      arch: 'x64',
      containerDigest: CONTAINER_DIGEST,
      platform: CONTAINER_PLATFORM,
    },
    visualContractHash: CONTRACT_HASH,
    adapter: { type: 'next-prerender', behaviorVersion: 1 },
    projects: DEFAULT_PROJECTS,
    routes: [{ route: '/', screenshotName: 'home.png' }],
    screenshots: DEFAULT_PROJECTS.map((project) => ({
      project: project.name,
      route: '/',
      path: `screenshots/${project.name}/home.png`,
      width: project.width,
      height: 2000,
      bytes: 1024,
      sha256: 'ab'.repeat(32),
    })),
    ...overrides,
  };
}

export interface CapturedStdio {
  stdout: string[];
  stderr: string[];
}

/** Captures raw stdout/stderr writes for the duration of a test. */
export function captureStdio(): CapturedStdio {
  const captured: CapturedStdio = { stdout: [], stderr: [] };
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    captured.stdout.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    captured.stderr.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write);
  return captured;
}
