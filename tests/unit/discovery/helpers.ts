import { fileURLToPath } from 'node:url';
import { DEFAULT_PROJECTS } from '../../../src/types.js';
import type { ResolvedVisualConfig } from '../../../src/types.js';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export interface ConfigOverrides {
  manifest?: string;
  include?: string[];
  exclude?: string[];
  additional?: string[];
}

export function makeConfig(overrides: ConfigOverrides = {}): ResolvedVisualConfig {
  const repoRoot = fileURLToPath(new URL('.', import.meta.url));
  return {
    repoRoot,
    configPath: `${repoRoot}visual-regression.config.ts`,
    framework: {
      type: 'next-prerender',
      manifestPath: fixturePath(overrides.manifest ?? 'manifest-v3.json'),
    },
    commands: { build: 'npm run build', start: 'npm run start' },
    server: { origin: 'http://127.0.0.1:3000', readinessPath: '/', startupTimeoutMs: 120_000 },
    routes: {
      include: overrides.include ?? ['/**'],
      exclude: overrides.exclude ?? [],
      additional: overrides.additional ?? [],
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
