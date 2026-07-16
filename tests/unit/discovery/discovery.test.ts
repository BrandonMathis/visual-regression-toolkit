import { describe, expect, it, vi } from 'vitest';
import { discoverRoutes } from '../../../src/discovery/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { fixturePath, makeConfig } from './helpers.js';

async function errorFrom(promise: Promise<unknown>): Promise<VisualRegressionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VisualRegressionError);
    return error as VisualRegressionError;
  }
  throw new Error('expected promise to reject');
}

describe('discoverRoutes', () => {
  describe('manifest reading', () => {
    it('fails with PRERENDER_MANIFEST_NOT_FOUND when the manifest is missing', async () => {
      const config = makeConfig();
      config.framework.manifestPath = fixturePath('does-not-exist.json');
      const error = await errorFrom(discoverRoutes(config));
      expect(error.code).toBe('PRERENDER_MANIFEST_NOT_FOUND');
      expect(error.message).toContain('production build');
      expect(error.context['path']).toBe(config.framework.manifestPath);
    });

    it('fails with PRERENDER_MANIFEST_UNSUPPORTED on malformed JSON', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ manifest: 'manifest-malformed.txt' })),
      );
      expect(error.code).toBe('PRERENDER_MANIFEST_UNSUPPORTED');
    });

    it('fails closed on an unknown manifest version', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ manifest: 'manifest-unknown-version.json' })),
      );
      expect(error.code).toBe('PRERENDER_MANIFEST_UNSUPPORTED');
      expect(error.message).toContain('5');
    });

    it('fails closed on a string manifest version', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ manifest: 'manifest-string-version.json' })),
      );
      expect(error.code).toBe('PRERENDER_MANIFEST_UNSUPPORTED');
    });

    it('fails closed when the routes key is missing', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ manifest: 'manifest-missing-routes.json' })),
      );
      expect(error.code).toBe('PRERENDER_MANIFEST_UNSUPPORTED');
    });

    it('fails closed when routes is not an object map', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ manifest: 'manifest-routes-array.json' })),
      );
      expect(error.code).toBe('PRERENDER_MANIFEST_UNSUPPORTED');
    });

    it('fails closed when the manifest itself is an array', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ manifest: 'manifest-array.json' })),
      );
      expect(error.code).toBe('PRERENDER_MANIFEST_UNSUPPORTED');
    });
  });

  describe('route selection', () => {
    it('discovers page routes from a version 3 manifest, sorted', async () => {
      const descriptors = await discoverRoutes(makeConfig());
      expect(descriptors.map((d) => d.route)).toEqual([
        '/',
        '/about',
        '/blog/first-post',
        '/blog/second-post',
        '/release/v1.2',
      ]);
    });

    it('discovers page routes from a version 4 manifest', async () => {
      const descriptors = await discoverRoutes(makeConfig({ manifest: 'manifest-v4.json' }));
      expect(descriptors.map((d) => d.route)).toEqual(['/', '/café', '/docs/getting-started']);
    });

    it('drops routes whose first segment starts with "_"', async () => {
      const descriptors = await discoverRoutes(makeConfig());
      expect(descriptors.map((d) => d.route)).not.toContain('/_internal/debug');
    });

    it('drops well-known metadata routes', async () => {
      const routes = (await discoverRoutes(makeConfig())).map((d) => d.route);
      expect(routes).not.toContain('/favicon.ico');
      expect(routes).not.toContain('/robots.txt');
      expect(routes).not.toContain('/sitemap.xml');
    });

    it('keeps dotted routes that are not well-known metadata files', async () => {
      const routes = (await discoverRoutes(makeConfig())).map((d) => d.route);
      expect(routes).toContain('/release/v1.2');
    });

    it('warns on stderr once, listing routes excluded by the metadata rule', async () => {
      const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      try {
        await discoverRoutes(makeConfig());
        const warnings = write.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes('metadata route'));
        expect(warnings).toHaveLength(1);
        const warning = warnings[0] as string;
        expect(warning).toContain('/favicon.ico');
        expect(warning).toContain('/robots.txt');
        expect(warning).toContain('/sitemap.xml');
        expect(warning).not.toContain('/release/v1.2');
      } finally {
        write.mockRestore();
      }
    });

    it('drops prerendered /404 and /500 error pages (direct navigation returns non-200)', async () => {
      const routes = (await discoverRoutes(makeConfig())).map((d) => d.route);
      expect(routes).not.toContain('/404');
      expect(routes).not.toContain('/500');
    });

    it('keeps /404 and /500 when explicitly opted in via routes.additional', async () => {
      const routes = (await discoverRoutes(makeConfig({ additional: ['/404', '/500'] }))).map(
        (d) => d.route,
      );
      expect(routes).toContain('/404');
      expect(routes).toContain('/500');
    });

    it('preserves original route strings, including unicode', async () => {
      const descriptors = await discoverRoutes(makeConfig({ manifest: 'manifest-v4.json' }));
      const cafe = descriptors.find((d) => d.route === '/café');
      expect(cafe).toBeDefined();
      expect(cafe?.screenshotName).toBe('caf_C3__A9_.png');
    });
  });

  describe('include/exclude globs', () => {
    it('keeps only routes matching an include glob', async () => {
      const descriptors = await discoverRoutes(makeConfig({ include: ['/blog/**'] }));
      expect(descriptors.map((d) => d.route)).toEqual(['/blog/first-post', '/blog/second-post']);
    });

    it('supports multiple include globs (union)', async () => {
      const descriptors = await discoverRoutes(makeConfig({ include: ['/', '/about'] }));
      expect(descriptors.map((d) => d.route)).toEqual(['/', '/about']);
    });

    it('applies exclude globs after include globs', async () => {
      const descriptors = await discoverRoutes(
        makeConfig({ include: ['/**'], exclude: ['/blog/**', '/release/**'] }),
      );
      expect(descriptors.map((d) => d.route)).toEqual(['/', '/about']);
    });

    it('supports ? and * in globs', async () => {
      const descriptors = await discoverRoutes(makeConfig({ include: ['/abou?', '/blog/*-post'] }));
      expect(descriptors.map((d) => d.route)).toEqual([
        '/about',
        '/blog/first-post',
        '/blog/second-post',
      ]);
    });

    it('does not apply include/exclude globs to additional routes', async () => {
      const descriptors = await discoverRoutes(
        makeConfig({ include: ['/about'], exclude: ['/extra'], additional: ['/extra'] }),
      );
      expect(descriptors.map((d) => d.route)).toEqual(['/about', '/extra']);
    });
  });

  describe('additional routes', () => {
    it('appends additional routes and dedupes against discovered ones', async () => {
      const descriptors = await discoverRoutes(makeConfig({ additional: ['/extra', '/about'] }));
      const routes = descriptors.map((d) => d.route);
      expect(routes).toContain('/extra');
      expect(routes.filter((route) => route === '/about')).toHaveLength(1);
    });

    it('returns a sorted, deduped result', async () => {
      const descriptors = await discoverRoutes(
        makeConfig({ additional: ['/zzz', '/aaa', '/zzz'] }),
      );
      const routes = descriptors.map((d) => d.route);
      expect(routes).toEqual([...routes].sort());
      expect(new Set(routes).size).toBe(routes.length);
    });
  });

  describe('unresolved parameters', () => {
    it('rejects manifest routes containing "[" or "]"', async () => {
      const config = makeConfig({ include: ['/**'] });
      // Simulate a manifest key that kept its dynamic placeholder.
      config.routes.additional = ['/blog/[slug]'];
      const error = await errorFrom(discoverRoutes(config));
      expect(error.code).toBe('UNRESOLVED_ROUTE_PARAMETER');
      expect(error.message).toContain('/blog/[slug]');
      expect(error.context['route']).toBe('/blog/[slug]');
    });

    it('rejects catch-all placeholders in additional routes', async () => {
      const error = await errorFrom(
        discoverRoutes(makeConfig({ additional: ['/docs/[...slug]'] })),
      );
      expect(error.code).toBe('UNRESOLVED_ROUTE_PARAMETER');
      expect(error.context['route']).toBe('/docs/[...slug]');
    });
  });

  describe('empty route set', () => {
    it('fails with EMPTY_ROUTE_SET when everything is excluded', async () => {
      const error = await errorFrom(discoverRoutes(makeConfig({ exclude: ['/**'] })));
      expect(error.code).toBe('EMPTY_ROUTE_SET');
    });

    it('fails with EMPTY_ROUTE_SET when nothing matches include', async () => {
      const error = await errorFrom(discoverRoutes(makeConfig({ include: ['/nope/**'] })));
      expect(error.code).toBe('EMPTY_ROUTE_SET');
    });

    it('passes when additional routes rescue an empty selection', async () => {
      const descriptors = await discoverRoutes(
        makeConfig({ include: ['/nope/**'], additional: ['/extra'] }),
      );
      expect(descriptors.map((d) => d.route)).toEqual(['/extra']);
    });
  });

  describe('screenshot naming integration', () => {
    it('assigns collision-checked names before any browser starts', async () => {
      const error = await errorFrom(discoverRoutes(makeConfig({ additional: ['/About'] })));
      expect(error.code).toBe('SCREENSHOT_NAME_COLLISION');
      expect(error.message).toContain('/About');
      expect(error.message).toContain('/about');
    });

    it('maps the root route to home.png', async () => {
      const descriptors = await discoverRoutes(makeConfig({ include: ['/'] }));
      expect(descriptors).toEqual([{ route: '/', screenshotName: 'home.png' }]);
    });
  });
});
