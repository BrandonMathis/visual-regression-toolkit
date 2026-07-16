import net from 'node:net';
import path from 'node:path';
import { expect } from 'vitest';
import { VisualRegressionError } from '../../../src/errors.js';
import { DEFAULT_PROJECTS, type ResolvedVisualConfig } from '../../../src/types.js';

export interface ConfigOverrides {
  build?: string;
  start?: string;
  origin?: string;
  readinessPath?: string;
  startupTimeoutMs?: number;
}

export function makeConfig(
  repoRoot: string,
  overrides: ConfigOverrides = {},
): ResolvedVisualConfig {
  return {
    repoRoot,
    configPath: path.join(repoRoot, 'visual-regression.config.ts'),
    framework: {
      type: 'next-prerender',
      manifestPath: path.join(repoRoot, '.next/prerender-manifest.json'),
    },
    commands: {
      build: overrides.build ?? 'node -e "process.exit(0)"',
      start: overrides.start ?? 'node -e "process.exit(0)"',
    },
    server: {
      origin: overrides.origin ?? 'http://127.0.0.1:39999',
      readinessPath: overrides.readinessPath ?? '/',
      startupTimeoutMs: overrides.startupTimeoutMs ?? 15_000,
    },
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

/** Reserve an ephemeral loopback port by briefly binding to port 0. */
export async function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export async function portClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
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
  throw new Error(`expected rejection with ${code}, but the promise resolved`);
}
