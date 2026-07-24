import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { getSitePages } from '../dist/route-discovery.js';

function withManifests({ prerender, appPaths }, callback) {
  const rootDir = mkdtempSync(resolve(tmpdir(), 'visual-routes-'));
  const nextDir = resolve(rootDir, '.next');
  mkdirSync(nextDir);

  if (prerender !== undefined) {
    writeFileSync(
      resolve(nextDir, 'prerender-manifest.json'),
      typeof prerender === 'string' ? prerender : JSON.stringify(prerender),
    );
  }
  if (appPaths !== undefined) {
    writeFileSync(
      resolve(nextDir, 'app-path-routes-manifest.json'),
      typeof appPaths === 'string' ? appPaths : JSON.stringify(appPaths),
    );
  }

  try {
    callback(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

test('merges, deduplicates, and sorts prerendered and fixed App Router routes', () => {
  withManifests(
    {
      prerender: {
        routes: {
          '/static': { dataRoute: '/static.rsc' },
          '/shared': { dataRoute: '/shared.rsc' },
          '/without-data': { dataRoute: null },
        },
      },
      appPaths: {
        '/page': '/',
        '/shared/page': '/shared',
        '/request-rendered/page': '/request-rendered',
      },
    },
    (rootDir) => {
      assert.deepEqual(getSitePages([], rootDir), ['/', '/request-rendered', '/shared', '/static']);
    },
  );
});

test('uses normalized route-group values and excludes non-page entries', () => {
  withManifests(
    {
      appPaths: {
        '/(marketing)/about/page': '/about',
        '/api/status/route': '/api/status',
        '/robots.txt/route': '/robots.txt',
        '/sitemap.xml/route': '/sitemap.xml',
      },
    },
    (rootDir) => {
      assert.deepEqual(getSitePages([], rootDir), ['/about']);
    },
  );
});

test('excludes internal routes, configured prefixes, and unresolved parameters', () => {
  withManifests(
    {
      prerender: {
        routes: {
          '/blog/first-post': { dataRoute: '/blog/first-post.rsc' },
          '/drafts/published': { dataRoute: '/drafts/published.rsc' },
        },
      },
      appPaths: {
        '/_not-found/page': '/_not-found',
        '/blog/[slug]/page': '/blog/[slug]',
        '/docs/[...slug]/page': '/docs/[...slug]',
        '/shop/[[...slug]]/page': '/shop/[[...slug]]',
      },
    },
    (rootDir) => {
      assert.deepEqual(getSitePages(['/drafts'], rootDir), ['/blog/first-post']);
    },
  );
});

test('tolerates one missing or corrupt manifest', () => {
  withManifests(
    {
      prerender: '{not-json',
      appPaths: { '/request-rendered/page': '/request-rendered' },
    },
    (rootDir) => {
      assert.deepEqual(getSitePages([], rootDir), ['/request-rendered']);
    },
  );

  withManifests(
    {
      prerender: { routes: { '/static': { dataRoute: '/static.rsc' } } },
    },
    (rootDir) => {
      assert.deepEqual(getSitePages([], rootDir), ['/static']);
    },
  );
});

test('reports a clear error when neither manifest can be read', () => {
  withManifests({ appPaths: '{not-json' }, (rootDir) => {
    assert.throws(
      () => getSitePages([], rootDir),
      /Could not read either Next\.js route manifest .*prerender-manifest\.json.*app-path-routes-manifest\.json/s,
    );
  });
});
