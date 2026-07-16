import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../../src/config/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { DEFAULT_PROJECTS } from '../../../src/types.js';
import type { VisualRegressionConfig } from '../../../src/types.js';

const REPO_ROOT = path.resolve('/repo');
const CONFIG_PATH = 'visual-regression.config.ts';

function minimalConfig(): VisualRegressionConfig {
  return {
    framework: { type: 'next-prerender' },
    commands: { build: 'npm run build', start: 'npm run start' },
    server: { origin: 'http://127.0.0.1:3000' },
  };
}

/** The exact example configuration from plan §5.2. */
function planExampleConfig(): VisualRegressionConfig {
  return {
    framework: {
      type: 'next-prerender',
      manifestPath: '.next/prerender-manifest.json',
    },
    commands: {
      build: 'npm run build',
      start: 'npm run start -- --hostname 127.0.0.1',
    },
    server: {
      origin: 'http://127.0.0.1:3000',
      readinessPath: '/',
      startupTimeoutMs: 120_000,
    },
    routes: {
      include: ['/**'],
      exclude: [],
      additional: [],
    },
    clock: {
      environmentVariable: 'VISUAL_TEST_DATE',
    },
    capture: {
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
      fontChecks: [],
      readinessSelectors: [],
      masks: [],
      externalRequests: {
        default: 'block',
        allow: ['self', 'data:', 'blob:'],
      },
      screenshot: {
        fullPage: true,
        threshold: 0.2,
      },
    },
  };
}

function resolve(raw: unknown) {
  return resolveConfig(raw, { repoRoot: REPO_ROOT, configPath: CONFIG_PATH });
}

function expectInvalid(raw: unknown, ...fragments: string[]): VisualRegressionError {
  let caught: unknown;
  try {
    resolve(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(VisualRegressionError);
  const error = caught as VisualRegressionError;
  expect(error.code).toBe('CONFIG_INVALID');
  for (const fragment of fragments) {
    expect(error.message).toContain(fragment);
  }
  return error;
}

describe('resolveConfig', () => {
  it('resolves the plan §5.2 example config with default projects', () => {
    const resolved = resolve(planExampleConfig());
    expect(resolved.repoRoot).toBe(REPO_ROOT);
    expect(resolved.configPath).toBe(path.join(REPO_ROOT, CONFIG_PATH));
    expect(resolved.framework).toEqual({
      type: 'next-prerender',
      manifestPath: path.join(REPO_ROOT, '.next/prerender-manifest.json'),
    });
    expect(resolved.commands).toEqual({
      build: 'npm run build',
      start: 'npm run start -- --hostname 127.0.0.1',
    });
    expect(resolved.server).toEqual({
      origin: 'http://127.0.0.1:3000',
      readinessPath: '/',
      startupTimeoutMs: 120_000,
    });
    expect(resolved.routes).toEqual({ include: ['/**'], exclude: [], additional: [] });
    expect(resolved.clock).toEqual({ environmentVariable: 'VISUAL_TEST_DATE' });
    expect(resolved.projects).toEqual(DEFAULT_PROJECTS);
    expect(resolved.capture).toEqual({
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
      fontChecks: [],
      readinessSelectors: [],
      masks: [],
      externalRequests: { default: 'block', allow: ['blob:', 'data:', 'self'] },
      screenshot: { fullPage: true, threshold: 0.2 },
    });
  });

  it('applies every default to a minimal config', () => {
    const resolved = resolve(minimalConfig());
    expect(resolved.framework.manifestPath).toBe(
      path.join(REPO_ROOT, '.next/prerender-manifest.json'),
    );
    expect(resolved.server.readinessPath).toBe('/');
    expect(resolved.server.startupTimeoutMs).toBe(120_000);
    expect(resolved.routes).toEqual({ include: ['/**'], exclude: [], additional: [] });
    expect(resolved.clock.environmentVariable).toBe('VISUAL_TEST_DATE');
    expect(resolved.projects).toEqual(DEFAULT_PROJECTS);
    expect(resolved.capture.colorScheme).toBe('light');
    expect(resolved.capture.locale).toBe('en-US');
    expect(resolved.capture.timezoneId).toBe('UTC');
    expect(resolved.capture.reducedMotion).toBe('reduce');
    expect(resolved.capture.externalRequests).toEqual({
      default: 'block',
      allow: ['blob:', 'data:', 'self'],
    });
    expect(resolved.capture.screenshot).toEqual({ fullPage: true, threshold: 0.2 });
  });

  it('sorts and dedupes order-independent arrays', () => {
    const resolved = resolve({
      ...minimalConfig(),
      routes: {
        include: ['/b/**', '/a/**', '/b/**'],
        exclude: ['/z', '/a', '/z'],
        additional: ['/extra', '/also', '/extra'],
      },
      capture: {
        fontChecks: ['Inter', 'Arial', 'Inter'],
        readinessSelectors: ['main', 'header', 'main'],
        masks: ['.b', '.a', '.b'],
        externalRequests: { allow: ['self', 'https://fonts.example.com', 'self'] },
      },
    });
    expect(resolved.routes.include).toEqual(['/a/**', '/b/**']);
    expect(resolved.routes.exclude).toEqual(['/a', '/z']);
    expect(resolved.routes.additional).toEqual(['/also', '/extra']);
    expect(resolved.capture.fontChecks).toEqual(['Arial', 'Inter']);
    expect(resolved.capture.readinessSelectors).toEqual(['header', 'main']);
    expect(resolved.capture.masks).toEqual(['.a', '.b']);
    expect(resolved.capture.externalRequests.allow).toEqual(['https://fonts.example.com', 'self']);
  });

  it('keeps custom projects in declared order and fills project defaults', () => {
    const resolved = resolve({
      ...minimalConfig(),
      projects: [
        { name: 'wide', width: 1920, height: 1080, deviceScaleFactor: 2 },
        { name: 'narrow', width: 320, height: 640, hasTouch: true, isMobile: true },
      ],
    });
    expect(resolved.projects).toEqual([
      {
        name: 'wide',
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
        hasTouch: false,
        isMobile: false,
      },
      {
        name: 'narrow',
        width: 320,
        height: 640,
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    ]);
  });

  it('accepts a localhost origin and trims command strings', () => {
    const resolved = resolve({
      ...minimalConfig(),
      commands: { build: '  npm run build  ', start: 'npm run start' },
      server: { origin: 'http://localhost:4321' },
    });
    expect(resolved.server.origin).toBe('http://localhost:4321');
    expect(resolved.commands.build).toBe('npm run build');
  });

  it('rejects non-object input', () => {
    expectInvalid(null);
    expectInvalid(42);
    expectInvalid(undefined);
  });

  it('rejects unknown top-level fields with the offending key path', () => {
    expectInvalid({ ...minimalConfig(), browser: 'firefox' }, 'browser', 'unknown field');
  });

  it('rejects unknown nested fields with the offending key path', () => {
    expectInvalid(
      { ...minimalConfig(), server: { origin: 'http://127.0.0.1:3000', port: 3000 } },
      'server.port',
      'unknown field',
    );
    expectInvalid(
      { ...minimalConfig(), capture: { screenshot: { quality: 80 } } },
      'capture.screenshot.quality',
      'unknown field',
    );
  });

  it('rejects missing required sections', () => {
    expectInvalid({ framework: { type: 'next-prerender' } }, 'commands', 'server');
  });

  it('rejects an unsupported framework type', () => {
    expectInvalid({ ...minimalConfig(), framework: { type: 'nuxt' } }, 'framework.type');
  });

  it('rejects invalid project names', () => {
    expectInvalid(
      { ...minimalConfig(), projects: [{ name: 'Desktop', width: 100, height: 100 }] },
      'projects[0].name',
      '^[a-z][a-z0-9-]*$',
    );
    expectInvalid(
      { ...minimalConfig(), projects: [{ name: '1phone', width: 100, height: 100 }] },
      'projects[0].name',
    );
  });

  it('rejects duplicate project names', () => {
    expectInvalid(
      {
        ...minimalConfig(),
        projects: [
          { name: 'desktop', width: 1440, height: 900 },
          { name: 'desktop', width: 1280, height: 720 },
        ],
      },
      'projects[1].name',
      'duplicate project name "desktop"',
    );
  });

  it('rejects an empty projects array', () => {
    expectInvalid({ ...minimalConfig(), projects: [] }, 'projects');
  });

  it('rejects invalid viewport dimensions', () => {
    const base = minimalConfig();
    expectInvalid(
      { ...base, projects: [{ name: 'a', width: 0, height: 100 }] },
      'projects[0].width',
    );
    expectInvalid(
      { ...base, projects: [{ name: 'a', width: 100, height: 20000 }] },
      'projects[0].height',
      '10000',
    );
    expectInvalid({ ...base, projects: [{ name: 'a', width: 99.5, height: 100 }] }, 'integer');
  });

  it('rejects deviceScaleFactor outside {1, 2, 3}', () => {
    expectInvalid(
      {
        ...minimalConfig(),
        projects: [{ name: 'a', width: 100, height: 100, deviceScaleFactor: 1.5 }],
      },
      'projects[0].deviceScaleFactor',
      'must be 1, 2, or 3',
    );
  });

  it('rejects non-loopback and non-http origins', () => {
    const withOrigin = (origin: string) => ({ ...minimalConfig(), server: { origin } });
    expectInvalid(withOrigin('http://example.com:3000'), 'server.origin', 'loopback');
    expectInvalid(withOrigin('http://0.0.0.0:3000'), 'server.origin');
    expectInvalid(withOrigin('https://127.0.0.1:3000'), 'server.origin', 'http:');
    expectInvalid(withOrigin('http://127.0.0.1:3000/app'), 'server.origin', 'path');
    expectInvalid(withOrigin('http://127.0.0.1:3000/?a=1'), 'server.origin');
    expectInvalid(withOrigin('not a url'), 'server.origin');
  });

  it('rejects unsafe route globs and additional routes', () => {
    const base = minimalConfig();
    expectInvalid({ ...base, routes: { include: ['**'] } }, 'routes.include[0]', 'start with "/"');
    expectInvalid({ ...base, routes: { exclude: ['/../secret'] } }, 'routes.exclude[0]', '".."');
    expectInvalid({ ...base, routes: { include: ['/a\\b'] } }, 'routes.include[0]', 'backslash');
    expectInvalid(
      { ...base, routes: { additional: ['/see://example.com'] } },
      'routes.additional[0]',
      'scheme',
    );
    expectInvalid({ ...base, routes: { additional: ['about'] } }, 'routes.additional[0]');
  });

  it('rejects absolute and escaping manifest paths', () => {
    const withManifest = (manifestPath: string) => ({
      ...minimalConfig(),
      framework: { type: 'next-prerender', manifestPath },
    });
    expectInvalid(withManifest('/etc/manifest.json'), 'framework.manifestPath', 'relative');
    expectInvalid(withManifest('../outside/manifest.json'), 'framework.manifestPath', 'inside');
    expectInvalid(withManifest('a/../../manifest.json'), 'framework.manifestPath');
    expectInvalid(withManifest('C:\\manifest.json'), 'framework.manifestPath');
    expectInvalid(withManifest(''), 'framework.manifestPath');
  });

  it('accepts a manifest path that stays inside the repo after normalization', () => {
    const resolved = resolve({
      ...minimalConfig(),
      framework: { type: 'next-prerender', manifestPath: 'apps/../.next/prerender-manifest.json' },
    });
    expect(resolved.framework.manifestPath).toBe(
      path.join(REPO_ROOT, '.next/prerender-manifest.json'),
    );
  });

  it('rejects empty or blank selector, mask, and font entries', () => {
    const base = minimalConfig();
    expectInvalid(
      { ...base, capture: { readinessSelectors: ['  '] } },
      'capture.readinessSelectors[0]',
    );
    expectInvalid({ ...base, capture: { masks: [''] } }, 'capture.masks[0]');
    expectInvalid({ ...base, capture: { fontChecks: ['\t'] } }, 'capture.fontChecks[0]');
  });

  it('accepts complex but valid CSS selectors', () => {
    const selectors = [
      '[data-x="a b"]',
      'main > .item:nth-child(2n+1)',
      '.a\\:b',
      '[data-note="semi;colon"]',
      ':is(h1, h2):not(.hidden)',
    ];
    const resolved = resolve({
      ...minimalConfig(),
      capture: { readinessSelectors: selectors, masks: selectors },
    });
    expect(resolved.capture.readinessSelectors).toEqual([...selectors].sort());
    expect(resolved.capture.masks).toEqual([...selectors].sort());
  });

  it('rejects structurally invalid CSS selectors with CONFIG_INVALID', () => {
    const base = minimalConfig();
    const cases: Array<[string, string]> = [
      ['[data-x="a]', 'unbalanced'],
      ['div[', 'unbalanced "["'],
      ['main > )', 'unbalanced ")"'],
      ['div; drop', 'semicolon'],
      ['`main`', 'backtick'],
      ['div\n[', 'control characters'],
      ['div /* comment */', 'comment'],
      ['> main', 'combinator'],
      ['.a\\', 'dangling'],
    ];
    for (const [selector, fragment] of cases) {
      expectInvalid(
        { ...base, capture: { readinessSelectors: [selector] } },
        'capture.readinessSelectors[0]',
        'invalid CSS selector',
        fragment,
      );
      expectInvalid(
        { ...base, capture: { masks: ['.ok', selector] } },
        'capture.masks[1]',
        'invalid CSS selector',
        fragment,
      );
    }
  });

  it('rejects out-of-range screenshot thresholds', () => {
    const withThreshold = (threshold: number) => ({
      ...minimalConfig(),
      capture: { screenshot: { threshold } },
    });
    expectInvalid(withThreshold(1.5), 'capture.screenshot.threshold', 'between 0 and 1');
    expectInvalid(withThreshold(-0.1), 'capture.screenshot.threshold');
  });

  it('rejects invalid startupTimeoutMs values', () => {
    const withTimeout = (startupTimeoutMs: number) => ({
      ...minimalConfig(),
      server: { origin: 'http://127.0.0.1:3000', startupTimeoutMs },
    });
    expectInvalid(withTimeout(0), 'server.startupTimeoutMs');
    expectInvalid(withTimeout(-5), 'server.startupTimeoutMs');
    expectInvalid(withTimeout(1.5), 'server.startupTimeoutMs');
  });

  it('rejects invalid clock environment variable names', () => {
    const withVar = (environmentVariable: string) => ({
      ...minimalConfig(),
      clock: { environmentVariable },
    });
    expectInvalid(withVar('visual_date'), 'clock.environmentVariable', '^[A-Z][A-Z0-9_]*$');
    expectInvalid(withVar('1DATE'), 'clock.environmentVariable');
    expectInvalid(withVar('MY-DATE'), 'clock.environmentVariable');
  });

  it('rejects invalid externalRequests.allow entries', () => {
    const withAllow = (allow: string[]) => ({
      ...minimalConfig(),
      capture: { externalRequests: { allow } },
    });
    expectInvalid(withAllow(['ftp://example.com']), 'capture.externalRequests.allow[0]');
    expectInvalid(withAllow(['example.com']), 'capture.externalRequests.allow[0]');
    expectInvalid(withAllow(['https://example.com/path']), 'capture.externalRequests.allow[0]');
    expectInvalid(withAllow(['javascript:alert(1)']), 'capture.externalRequests.allow[0]');
  });

  it('accepts and normalizes valid externalRequests.allow origins', () => {
    const resolved = resolve({
      ...minimalConfig(),
      capture: { externalRequests: { allow: ['self', 'HTTPS://Fonts.Example.COM'] } },
    });
    expect(resolved.capture.externalRequests.allow).toEqual(['https://fonts.example.com', 'self']);
  });

  it('lists every problem in one actionable message', () => {
    const error = expectInvalid(
      {
        framework: { type: 'next-prerender', manifestPath: '/abs' },
        commands: { build: '', start: 'npm run start' },
        server: { origin: 'https://example.com' },
        unknownField: true,
      },
      'framework.manifestPath',
      'commands.build',
      'server.origin',
      'unknownField',
    );
    expect(Number(error.context['problems'])).toBeGreaterThanOrEqual(4);
  });
});
