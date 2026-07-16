/**
 * Minimal dependency-free glob matching for route paths (plan §6.5).
 *
 * Supported syntax:
 * - `*`  matches any run of characters (including none) within one path
 *   segment, i.e. never matches `/`.
 * - `**` matches any run of characters (including none) across segments,
 *   i.e. it may match `/`. `/**` therefore matches `/` and every route.
 * - `?`  matches exactly one character other than `/`.
 *
 * Every other character matches itself literally. Patterns are anchored:
 * the whole route must match.
 */
const REGEX_SPECIALS = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

export function globToRegExp(pattern: string): RegExp {
  let source = '^';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i] as string;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i += 2;
      } else {
        source += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      source += '[^/]';
      i += 1;
    } else {
      source += REGEX_SPECIALS.has(char) ? `\\${char}` : char;
      i += 1;
    }
  }
  return new RegExp(`${source}$`);
}

export function matchRouteGlob(route: string, pattern: string): boolean {
  return globToRegExp(pattern).test(route);
}
