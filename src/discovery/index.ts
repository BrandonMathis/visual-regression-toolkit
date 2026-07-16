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
 * Well-known metadata/asset final segments (favicon.ico, robots.txt,
 * sitemap*.xml, manifest.webmanifest, and image/data extensions). Only these
 * are treated as non-page metadata entries; any other dotted final segment
 * (e.g. /release/v1.2) is a real prerendered page and is kept.
 */
const METADATA_FINAL_SEGMENT = /\.(?:ico|png|jpe?g|svg|gif|webp|txt|xml|json|webmanifest)$/i;

/**
 * Classifies a prerender-manifest route:
 * - 'internal': first segment starts with '_' (Next.js internals such as
 *   /_app or /_error); dropped silently.
 * - 'error-page': exactly /404 or /500. Next serves these paths with their
 *   literal HTTP status, and capture requires a 200 (ok) response, so direct
 *   navigation is guaranteed to fail with NAVIGATION_FAILED; dropped from
 *   manifest discovery. Listing them in routes.additional is an explicit
 *   opt-in that bypasses this exclusion.
 * - 'metadata': final segment matches METADATA_FINAL_SEGMENT; dropped with a
 *   stderr warning so coverage shrinkage is never silent.
 * - 'page': everything else, including dotted routes like /release/v1.2.
 */
function classifyManifestRoute(route: string): 'page' | 'internal' | 'error-page' | 'metadata' {
  const segments = route.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return route === '/' ? 'page' : 'internal';
  }
  const first = segments[0] as string;
  const last = segments[segments.length - 1] as string;
  if (first.startsWith('_')) {
    return 'internal';
  }
  if (route === '/404' || route === '/500') {
    return 'error-page';
  }
  if (METADATA_FINAL_SEGMENT.test(last)) {
    return 'metadata';
  }
  return 'page';
}

export async function discoverRoutes(config: ResolvedVisualConfig): Promise<RouteDescriptor[]> {
  const manifestRoutes = await readPrerenderManifestRoutes(config.framework.manifestPath);
  const { include, exclude, additional } = config.routes;

  const metadataExcluded = manifestRoutes.filter(
    (route) => classifyManifestRoute(route) === 'metadata',
  );
  if (metadataExcluded.length > 0) {
    process.stderr.write(
      `[warn] Excluded ${metadataExcluded.length} metadata route(s) from discovery: ` +
        `${metadataExcluded.join(', ')} (list a route in routes.additional to capture it anyway)\n`,
    );
  }

  const selected = manifestRoutes
    .filter((route) => classifyManifestRoute(route) === 'page')
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
