/**
 * Drives discoverRoutes against synthetic prerender manifests in temp dirs,
 * covering shapes the fixture app cannot produce (missing, malformed,
 * unsupported versions, unresolved params, empty route sets).
 *
 * Depends only on src/discovery; the resolved config is built by hand.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverRoutes } from '../../src/discovery/index.js';
import {
  expectErrorCode,
  makeManifestDir,
  makeResolvedConfig,
  removeDir,
  syntheticManifest,
} from './helpers.js';

const tempDirs: string[] = [];

async function manifestDir(content: string | Record<string, unknown>): Promise<string> {
  const dir = await makeManifestDir(content);
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeDir(dir)));
});

describe('discoverRoutes against synthetic manifests', () => {
  it('fails with PRERENDER_MANIFEST_NOT_FOUND when the manifest is missing', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'vr-discovery-'));
    tempDirs.push(repoRoot);
    const config = makeResolvedConfig(repoRoot);
    await expectErrorCode(discoverRoutes(config), 'PRERENDER_MANIFEST_NOT_FOUND');
  });

  it('fails closed on malformed JSON', async () => {
    const repoRoot = await manifestDir('{ this is not json');
    const config = makeResolvedConfig(repoRoot);
    await expectErrorCode(discoverRoutes(config), 'PRERENDER_MANIFEST_UNSUPPORTED');
  });

  it('fails closed on an unsupported manifest version', async () => {
    const repoRoot = await manifestDir(syntheticManifest(['/', '/about'], { version: 99 }));
    const config = makeResolvedConfig(repoRoot);
    await expectErrorCode(discoverRoutes(config), 'PRERENDER_MANIFEST_UNSUPPORTED');
  });

  it('fails closed when routes is not an object', async () => {
    const repoRoot = await manifestDir({ version: 4, routes: [], dynamicRoutes: {} });
    const config = makeResolvedConfig(repoRoot);
    await expectErrorCode(discoverRoutes(config), 'PRERENDER_MANIFEST_UNSUPPORTED');
  });

  it('drops internal routes, applies globs, adds additional routes, sorts, and dedupes', async () => {
    const repoRoot = await manifestDir(
      syntheticManifest(['/', '/_not-found', '/_global-error', '/b', '/a', '/drafts/secret']),
    );
    const config = makeResolvedConfig(repoRoot, {
      routes: { exclude: ['/drafts/**'], additional: ['/a', '/zz'] },
    });
    const routes = await discoverRoutes(config);
    expect(routes.map((descriptor) => descriptor.route)).toEqual(['/', '/a', '/b', '/zz']);
    expect(routes[0]?.screenshotName).toBe('home.png');
  });

  it('does not select dynamic-route patterns as routes', async () => {
    const repoRoot = await manifestDir(
      syntheticManifest(['/', '/blog/first'], {
        dynamicRoutes: {
          '/blog/[slug]': {
            routeRegex: '^/blog/([^/]+?)(?:/)?$',
            dataRoute: '/blog/[slug].rsc',
            fallback: false,
            allowHeader: ['host'],
          },
        },
      }),
    );
    const config = makeResolvedConfig(repoRoot);
    const routes = await discoverRoutes(config);
    expect(routes.map((descriptor) => descriptor.route)).toEqual(['/', '/blog/first']);
  });

  it('rejects an unresolved parameter in additional routes', async () => {
    const repoRoot = await manifestDir(syntheticManifest(['/']));
    const config = makeResolvedConfig(repoRoot, {
      routes: { additional: ['/blog/[slug]'] },
    });
    await expectErrorCode(discoverRoutes(config), 'UNRESOLVED_ROUTE_PARAMETER');
  });

  it('rejects an unresolved parameter route present in the manifest routes', async () => {
    const repoRoot = await manifestDir(syntheticManifest(['/', '/blog/[slug]']));
    const config = makeResolvedConfig(repoRoot);
    await expectErrorCode(discoverRoutes(config), 'UNRESOLVED_ROUTE_PARAMETER');
  });

  it('fails with EMPTY_ROUTE_SET when exclusions remove every route', async () => {
    const repoRoot = await manifestDir(syntheticManifest(['/', '/about']));
    const config = makeResolvedConfig(repoRoot, { routes: { exclude: ['/**'] } });
    await expectErrorCode(discoverRoutes(config), 'EMPTY_ROUTE_SET');
  });

  it('fails with EMPTY_ROUTE_SET when the manifest only contains internal routes', async () => {
    const repoRoot = await manifestDir(syntheticManifest(['/_not-found']));
    const config = makeResolvedConfig(repoRoot);
    await expectErrorCode(discoverRoutes(config), 'EMPTY_ROUTE_SET');
  });
});
