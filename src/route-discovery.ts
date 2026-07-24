import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PrerenderedRoute {
  dataRoute: string | null;
}

interface PrerenderManifest {
  routes: Record<string, PrerenderedRoute>;
}

type AppPathRoutesManifest = Record<string, string>;

interface ManifestResult {
  routes: string[];
  error?: unknown;
}

function readPrerenderRoutes(rootDir: string): ManifestResult {
  const manifestPath = resolve(rootDir, '.next/prerender-manifest.json');

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PrerenderManifest;
    return {
      routes: Object.entries(manifest.routes)
        .filter(([, details]) => details.dataRoute !== null)
        .map(([route]) => route),
    };
  } catch (error) {
    return { routes: [], error };
  }
}

function readAppPathRoutes(rootDir: string): ManifestResult {
  const manifestPath = resolve(rootDir, '.next/app-path-routes-manifest.json');

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AppPathRoutesManifest;
    return {
      routes: Object.entries(manifest)
        .filter(([source]) => source === '/page' || source.endsWith('/page'))
        .map(([, route]) => route),
    };
  } catch (error) {
    return { routes: [], error };
  }
}

function isUnresolvedDynamicRoute(route: string) {
  return /\[[^\]]+\]/.test(route);
}

export function getSitePages(exclude: string[], rootDir = process.cwd()) {
  const prerender = readPrerenderRoutes(rootDir);
  const appPaths = readAppPathRoutes(rootDir);

  if (prerender.error && appPaths.error) {
    throw new Error(
      'Could not read either Next.js route manifest (.next/prerender-manifest.json or ' +
        '.next/app-path-routes-manifest.json). Run visual tests through "npm run test:visual" ' +
        'after a successful Next.js build.',
      { cause: new AggregateError([prerender.error, appPaths.error]) },
    );
  }

  return [...new Set([...prerender.routes, ...appPaths.routes])]
    .filter(
      (route) =>
        !route.startsWith('/_') &&
        !exclude.some((prefix) => route.startsWith(prefix)) &&
        !isUnresolvedDynamicRoute(route),
    )
    .sort();
}
