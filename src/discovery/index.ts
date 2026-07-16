/**
 * Next.js prerender route discovery and screenshot naming (plan §6).
 *
 * IMPLEMENTATION CONTRACT (agent: replace bodies, keep signatures):
 * - discoverRoutes: read the prerender manifest (only valid after a build),
 *   fail closed on unknown shapes (PRERENDER_MANIFEST_UNSUPPORTED), select
 *   prerendered HTML routes, drop '/_*' and non-page entries, apply
 *   include/exclude globs, add config.routes.additional, reject unresolved
 *   params ('/blog/[slug]' -> UNRESOLVED_ROUTE_PARAMETER), sort + dedupe,
 *   fail on empty set (EMPTY_ROUTE_SET), assign collision-checked names.
 * - screenshotNameForRoute: '/' -> 'home.png'; portable, traversal-safe,
 *   Unicode/reserved chars percent-style encoded (SCREENSHOT_NAME_INVALID).
 * - assignScreenshotNames: sort, dedupe, detect collisions before any browser
 *   starts (SCREENSHOT_NAME_COLLISION).
 */
import type { ResolvedVisualConfig, RouteDescriptor } from '../types.js';

export async function discoverRoutes(config: ResolvedVisualConfig): Promise<RouteDescriptor[]> {
  void config;
  throw new Error('not implemented');
}

export function screenshotNameForRoute(route: string): string {
  void route;
  throw new Error('not implemented');
}

export function assignScreenshotNames(routes: string[]): RouteDescriptor[] {
  void routes;
  throw new Error('not implemented');
}
