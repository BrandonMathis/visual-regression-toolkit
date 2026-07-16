/**
 * Builds the fixture Next.js app and drives loadConfig + discoverRoutes
 * against its real prerender manifest.
 *
 * The 'fixture build output' suite is self-contained. The 'fixture config
 * loading' and 'fixture route discovery' suites exercise src/config and
 * src/discovery and pass once those modules are implemented.
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { discoverRoutes } from '../../src/discovery/index.js';

const execFileAsync = promisify(execFile);

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'next-app');
const configPath = join(fixtureRoot, 'visual-regression.config.ts');
const manifestPath = join(fixtureRoot, '.next', 'prerender-manifest.json');

// NFC escape: the generateStaticParams literal is NFC, so the manifest route is too.
const CAFE_ROUTE = '/menu/café';
const EXPECTED_ROUTES = ['/', '/about', CAFE_ROUTE, '/products/alpha', '/products/beta'];
// Portable screenshot names: ASCII-only, no separators, percent-style escapes allowed.
const PORTABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9._%-]*\.png$/;

function newestSourceMtimeMs(): number {
  const roots = [join(fixtureRoot, 'app'), join(fixtureRoot, 'public')];
  const files = [join(fixtureRoot, 'package.json'), configPath];
  let newest = 0;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  for (const root of roots) visit(root);
  for (const file of files) newest = Math.max(newest, statSync(file).mtimeMs);
  return newest;
}

function manifestIsFresh(): boolean {
  return existsSync(manifestPath) && statSync(manifestPath).mtimeMs >= newestSourceMtimeMs();
}

beforeAll(async () => {
  if (manifestIsFresh()) return;
  if (!existsSync(join(fixtureRoot, 'node_modules'))) {
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: fixtureRoot,
      timeout: 240_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  await execFileAsync('npm', ['run', 'build'], {
    cwd: fixtureRoot,
    timeout: 280_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}, 300_000);

describe('fixture build output', () => {
  it('produces a version-4 prerender manifest', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: number;
      routes: Record<string, unknown>;
      dynamicRoutes: Record<string, unknown>;
    };
    expect(manifest.version).toBe(4);
    expect(manifest.routes).toBeTypeOf('object');
    expect(manifest.dynamicRoutes).toBeTypeOf('object');
  });

  it('prerenders every expected route plus the excluded drafts page', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      routes: Record<string, unknown>;
    };
    const routeKeys = Object.keys(manifest.routes);
    for (const route of [...EXPECTED_ROUTES, '/drafts/hidden']) {
      expect(routeKeys, `manifest missing ${route}`).toContain(route);
    }
  });

  it('contains internal and dynamic-pattern entries that discovery must not select', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      routes: Record<string, unknown>;
      dynamicRoutes: Record<string, unknown>;
    };
    expect(Object.keys(manifest.routes).some((route) => route.startsWith('/_'))).toBe(true);
    expect(Object.keys(manifest.dynamicRoutes).sort()).toEqual([
      '/menu/[item]',
      '/products/[slug]',
    ]);
  });

  it('bakes the VISUAL_TEST_DATE element into the prerendered home page', () => {
    const homeHtml = readFileSync(
      join(fixtureRoot, '.next', 'server', 'app', 'index.html'),
      'utf8',
    );
    expect(homeHtml).toContain('data-testid="visual-test-date"');
    // Built without the env var set, so the sentinel fallback must be baked in.
    expect(homeHtml).toContain('VISUAL_TEST_DATE-unset');
  });
});

describe('fixture config loading', () => {
  it('loads the fixture config with the drafts exclusion applied', async () => {
    const resolved = await loadConfig(configPath, fixtureRoot);
    expect(resolved.routes.exclude).toEqual(['/drafts/**']);
    expect(resolved.routes.include).toEqual(['/**']);
    expect(resolved.routes.additional).toEqual([]);
    expect(resolved.server.origin).toBe('http://127.0.0.1:3111');
    expect(resolved.server.startupTimeoutMs).toBe(120_000);
    expect(resolved.commands.build).toBe('npm run build');
    expect(resolved.commands.start).toBe('npm run start -- --hostname 127.0.0.1 --port 3111');
    expect(resolved.framework.type).toBe('next-prerender');
    expect(resolved.framework.manifestPath).toBe(manifestPath);
    expect(resolved.clock.environmentVariable).toBe('VISUAL_TEST_DATE');
    expect(resolved.projects.map((project) => project.name)).toEqual([
      'desktop',
      'tablet',
      'phone',
    ]);
  });
});

describe('fixture route discovery', () => {
  it('returns exactly the expected sorted routes', async () => {
    const resolved = await loadConfig(configPath, fixtureRoot);
    const routes = await discoverRoutes(resolved);
    expect(routes.map((descriptor) => descriptor.route)).toEqual(EXPECTED_ROUTES);
  });

  it('names the home route home.png and every route portably and uniquely', async () => {
    const resolved = await loadConfig(configPath, fixtureRoot);
    const routes = await discoverRoutes(resolved);
    const home = routes.find((descriptor) => descriptor.route === '/');
    expect(home?.screenshotName).toBe('home.png');
    const names = routes.map((descriptor) => descriptor.screenshotName);
    for (const name of names) {
      expect(name, `screenshot name ${JSON.stringify(name)} is not portable`).toMatch(
        PORTABLE_NAME,
      );
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('excludes /drafts/hidden and internal routes', async () => {
    const resolved = await loadConfig(configPath, fixtureRoot);
    const routes = await discoverRoutes(resolved);
    const values = routes.map((descriptor) => descriptor.route);
    expect(values).not.toContain('/drafts/hidden');
    expect(values.some((route) => route.startsWith('/_'))).toBe(false);
    expect(values.some((route) => route.includes('['))).toBe(false);
  });
});
