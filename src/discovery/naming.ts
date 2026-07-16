import { createHash } from 'node:crypto';
import { VisualRegressionError } from '../errors.js';
import type { RouteDescriptor } from '../types.js';

/**
 * Screenshot naming (plan §6). Names are single portable basenames: route
 * segments joined with '--', every character outside [A-Za-z0-9._-] encoded
 * as one `_XX_` escape per UTF-8 byte (uppercase hex). The encoding is
 * deterministic but not injective; assignScreenshotNames catches collisions
 * before any browser starts.
 */

const ALLOWED_CHAR = /^[A-Za-z0-9._-]$/;
/** Longest allowed basename including the '.png' extension. */
const MAX_NAME_LENGTH = 180;
const HASH_SUFFIX_LENGTH = 8;

function encodeSegment(segment: string): string {
  let out = '';
  for (const char of segment) {
    if (ALLOWED_CHAR.test(char)) {
      out += char;
    } else {
      for (const byte of Buffer.from(char, 'utf8')) {
        out += `_${byte.toString(16).toUpperCase().padStart(2, '0')}_`;
      }
    }
  }
  return out;
}

function invalidName(route: string, reason: string): VisualRegressionError {
  return new VisualRegressionError(
    'SCREENSHOT_NAME_INVALID',
    `Cannot derive a screenshot name for route "${route}": ${reason}.`,
    { context: { route } },
  );
}

export function screenshotNameForRoute(route: string): string {
  if (route === '/') {
    return 'home.png';
  }
  if (!route.startsWith('/')) {
    // Also rejects Windows-absolute inputs such as 'C:\\x' or 'C:/x'.
    throw invalidName(route, 'routes must start with "/"');
  }
  if (route.includes('\\')) {
    throw invalidName(route, 'backslashes are not allowed');
  }
  if (route.includes('..')) {
    throw invalidName(route, '".." path traversal is not allowed');
  }
  const segments = route.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw invalidName(route, 'route normalizes to an empty path');
  }
  if (segments.some((segment) => /^\.+$/.test(segment))) {
    throw invalidName(route, 'dot-only path segments are not allowed');
  }
  const stem = segments.map(encodeSegment).join('--');
  const name = `${stem}.png`;
  if (name.length <= MAX_NAME_LENGTH) {
    return name;
  }
  // Truncation may cut through an _XX_ escape; the route-derived hash suffix
  // keeps the name unique and deterministic regardless.
  const hash = createHash('sha256').update(route).digest('hex').slice(0, HASH_SUFFIX_LENGTH);
  const prefix = stem.slice(0, MAX_NAME_LENGTH - HASH_SUFFIX_LENGTH - '-.png'.length);
  return `${prefix}-${hash}.png`;
}

/**
 * Sorts, dedupes, and names routes, failing on case-insensitive name
 * collisions (macOS/Windows filesystems are case-insensitive). Must run
 * before any browser starts.
 */
export function assignScreenshotNames(routes: string[]): RouteDescriptor[] {
  const unique = [...new Set(routes)].sort();
  const byLowerName = new Map<string, RouteDescriptor>();
  const descriptors: RouteDescriptor[] = [];
  for (const route of unique) {
    const screenshotName = screenshotNameForRoute(route);
    const key = screenshotName.toLowerCase();
    const existing = byLowerName.get(key);
    if (existing !== undefined) {
      throw new VisualRegressionError(
        'SCREENSHOT_NAME_COLLISION',
        `Routes "${existing.route}" and "${route}" map to the same screenshot name ` +
          `("${existing.screenshotName}" vs "${screenshotName}", compared case-insensitively).`,
        {
          context: {
            route: existing.route,
            conflictingRoute: route,
            screenshotName,
          },
        },
      );
    }
    const descriptor: RouteDescriptor = { route, screenshotName };
    byLowerName.set(key, descriptor);
    descriptors.push(descriptor);
  }
  return descriptors;
}
