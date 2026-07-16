/**
 * Next.js prerender route discovery and screenshot naming (plan §6).
 *
 * Pipeline: read the prerender manifest (fail closed on unknown shapes),
 * keep prerendered HTML page routes, apply include then exclude globs,
 * append configured additional routes, reject unresolved dynamic
 * parameters, sort + dedupe, fail on an empty set, then assign
 * collision-checked screenshot names before any browser starts.
 */
import { VisualRegressionError } from '../errors.js';
import type { ResolvedVisualConfig, RouteDescriptor } from '../types.js';
import { matchRouteGlob } from './glob.js';
import { readPrerenderManifestRoutes } from './manifest.js';
import { assignScreenshotNames, screenshotNameForRoute } from './naming.js';

export { assignScreenshotNames, screenshotNameForRoute };

/**
 * A manifest entry is a capturable HTML page route unless:
 * - its first segment starts with '_' (Next.js internals such as /_app), or
 * - its final segment contains a '.' (metadata/asset entries such as
 *   /favicon.ico, /robots.txt, /sitemap.xml).
 * Prerendered error pages like /404 and /500 are real pages and are kept.
 */
function isPageRoute(route: string): boolean {
  const segments = route.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return route === '/';
  }
  const first = segments[0] as string;
  const last = segments[segments.length - 1] as string;
  return !first.startsWith('_') && !last.includes('.');
}

export async function discoverRoutes(config: ResolvedVisualConfig): Promise<RouteDescriptor[]> {
  const manifestRoutes = await readPrerenderManifestRoutes(config.framework.manifestPath);
  const { include, exclude, additional } = config.routes;

  const selected = manifestRoutes
    .filter(isPageRoute)
    .filter((route) => include.some((pattern) => matchRouteGlob(route, pattern)))
    .filter((route) => !exclude.some((pattern) => matchRouteGlob(route, pattern)));

  const candidates = [...selected, ...additional];
  for (const route of candidates) {
    if (route.includes('[') || route.includes(']')) {
      throw new VisualRegressionError(
        'UNRESOLVED_ROUTE_PARAMETER',
        `Route "${route}" contains an unresolved dynamic parameter. ` +
          'Exclude it or list concrete paths in routes.additional.',
        { context: { route } },
      );
    }
  }

  if (candidates.length === 0) {
    throw new VisualRegressionError(
      'EMPTY_ROUTE_SET',
      'No routes remain after manifest selection, include/exclude globs, and additional routes. ' +
        'Refusing to produce an empty baseline.',
      { context: { path: config.framework.manifestPath } },
    );
  }

  return assignScreenshotNames(candidates);
}
