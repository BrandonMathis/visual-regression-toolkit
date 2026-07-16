import type { ResolvedProject, ResolvedVisualConfig } from '../../../src/types.js';

export const DESKTOP: ResolvedProject = {
  name: 'desktop',
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
};

export const PHONE: ResolvedProject = {
  name: 'phone',
  width: 375,
  height: 812,
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};

export function makeResolvedConfig(
  overrides: {
    origin?: string;
    projects?: ResolvedProject[];
    capture?: Partial<ResolvedVisualConfig['capture']>;
  } = {},
): ResolvedVisualConfig {
  return {
    repoRoot: '/consumer',
    configPath: '/consumer/visual-regression.config.ts',
    framework: {
      type: 'next-prerender',
      manifestPath: '/consumer/.next/prerender-manifest.json',
    },
    commands: { build: 'npm run build', start: 'npm run start' },
    server: {
      origin: overrides.origin ?? 'http://127.0.0.1:3000',
      readinessPath: '/',
      startupTimeoutMs: 120_000,
    },
    routes: { include: ['/**'], exclude: [], additional: [] },
    clock: { environmentVariable: 'VISUAL_TEST_DATE' },
    projects: overrides.projects ?? [DESKTOP, PHONE],
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
      ...overrides.capture,
    },
  };
}
