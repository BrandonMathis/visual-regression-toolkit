import { describe, expect, it } from 'vitest';
import { computeVisualContractHash, resolveConfig } from '../../../src/config/index.js';
import type { ResolvedVisualConfig, VisualRegressionConfig } from '../../../src/types.js';

const OPTIONS = { repoRoot: '/repo', configPath: 'visual-regression.config.ts' };

function baseConfig(): VisualRegressionConfig {
  return {
    framework: { type: 'next-prerender' },
    commands: { build: 'npm run build', start: 'npm run start' },
    server: { origin: 'http://127.0.0.1:3000' },
    capture: {
      fontChecks: ['Inter', 'Roboto'],
      readinessSelectors: ['main'],
      masks: ['.ad', '.clock'],
      externalRequests: { default: 'block', allow: ['self', 'data:', 'blob:'] },
    },
  };
}

function hashOf(raw: VisualRegressionConfig, options = OPTIONS): string {
  return computeVisualContractHash(resolveConfig(raw, options));
}

function mutate(change: (config: VisualRegressionConfig) => void): string {
  const config = baseConfig();
  change(config);
  return hashOf(config);
}

describe('computeVisualContractHash', () => {
  it('produces a 64-char lowercase sha256 hex string', () => {
    expect(hashOf(baseConfig())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for equivalent configs written in different key and array orders', () => {
    const reordered: VisualRegressionConfig = {
      server: { origin: 'http://127.0.0.1:3000' },
      capture: {
        externalRequests: { allow: ['blob:', 'self', 'data:'], default: 'block' },
        masks: ['.clock', '.ad'],
        readinessSelectors: ['main'],
        fontChecks: ['Roboto', 'Inter'],
      },
      commands: { start: 'npm run start', build: 'npm run build' },
      framework: { type: 'next-prerender' },
    };
    expect(hashOf(reordered)).toBe(hashOf(baseConfig()));
  });

  it('treats explicitly spelled-out defaults the same as omitted defaults', () => {
    const explicit = mutate((config) => {
      config.capture = {
        ...config.capture,
        colorScheme: 'light',
        locale: 'en-US',
        timezoneId: 'UTC',
        reducedMotion: 'reduce',
        screenshot: { fullPage: true, threshold: 0.2 },
      };
      config.projects = [
        { name: 'desktop', width: 1440, height: 900 },
        { name: 'tablet', width: 768, height: 1024, hasTouch: true },
        { name: 'phone', width: 375, height: 812, hasTouch: true, isMobile: true },
      ];
    });
    expect(explicit).toBe(hashOf(baseConfig()));
  });

  it('ignores project declaration order (hash sorts projects by name)', () => {
    const forward = mutate((config) => {
      config.projects = [
        { name: 'a', width: 100, height: 100 },
        { name: 'b', width: 200, height: 200 },
      ];
    });
    const reversed = mutate((config) => {
      config.projects = [
        { name: 'b', width: 200, height: 200 },
        { name: 'a', width: 100, height: 100 },
      ];
    });
    expect(forward).toBe(reversed);
  });

  it('changes when any pixel-affecting setting changes', () => {
    const base = hashOf(baseConfig());
    const variants: Array<(config: VisualRegressionConfig) => void> = [
      (c) => (c.capture = { ...c.capture, colorScheme: 'dark' }),
      (c) => (c.capture = { ...c.capture, locale: 'de-DE' }),
      (c) => (c.capture = { ...c.capture, timezoneId: 'America/New_York' }),
      (c) => (c.capture = { ...c.capture, reducedMotion: 'no-preference' }),
      (c) => (c.capture = { ...c.capture, fontChecks: ['Inter'] }),
      (c) => (c.capture = { ...c.capture, readinessSelectors: ['main', 'footer'] }),
      (c) => (c.capture = { ...c.capture, masks: ['.ad'] }),
      (c) =>
        (c.capture = {
          ...c.capture,
          externalRequests: { default: 'allow', allow: ['self', 'data:', 'blob:'] },
        }),
      (c) =>
        (c.capture = {
          ...c.capture,
          externalRequests: {
            default: 'block',
            allow: ['self', 'data:', 'blob:', 'https://cdn.example.com'],
          },
        }),
      (c) => (c.capture = { ...c.capture, screenshot: { fullPage: false } }),
      (c) => (c.capture = { ...c.capture, screenshot: { threshold: 0.3 } }),
      (c) => (c.projects = [{ name: 'desktop', width: 1280, height: 900 }]),
      (c) => (c.projects = [{ name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2 }]),
      (c) => (c.projects = [{ name: 'desktop', width: 1440, height: 900, hasTouch: true }]),
    ];
    const hashes = variants.map((change) => mutate(change));
    for (const hash of hashes) {
      expect(hash).not.toBe(base);
    }
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('does not change when excluded settings change', () => {
    const base = hashOf(baseConfig());
    const variants: Array<(config: VisualRegressionConfig) => void> = [
      (c) => (c.routes = { include: ['/blog/**'], exclude: ['/drafts/**'], additional: ['/x'] }),
      (c) => (c.commands = { build: 'pnpm build', start: 'pnpm start' }),
      (c) => (c.server = { origin: 'http://localhost:4000', startupTimeoutMs: 5_000 }),
      (c) => (c.server = { origin: 'http://127.0.0.1:3000', readinessPath: '/healthz' }),
      (c) => (c.clock = { environmentVariable: 'OTHER_DATE_VAR' }),
      (c) =>
        (c.framework = {
          type: 'next-prerender',
          manifestPath: 'apps/web/.next/prerender-manifest.json',
        }),
    ];
    for (const change of variants) {
      expect(mutate(change)).toBe(base);
    }
  });

  it('does not change with repoRoot or configPath', () => {
    const a = hashOf(baseConfig(), { repoRoot: '/repo', configPath: 'a.config.ts' });
    const b = hashOf(baseConfig(), { repoRoot: '/elsewhere', configPath: 'b/visual.config.ts' });
    expect(a).toBe(b);
  });

  it('does not mutate the resolved config it hashes', () => {
    const resolved: ResolvedVisualConfig = resolveConfig(baseConfig(), OPTIONS);
    const projectNames = resolved.projects.map((p) => p.name);
    computeVisualContractHash(resolved);
    expect(resolved.projects.map((p) => p.name)).toEqual(projectNames);
  });
});
