import { describe, expect, it } from 'vitest';
import { assignScreenshotNames, screenshotNameForRoute } from '../../../src/discovery/index.js';
import { VisualRegressionError } from '../../../src/errors.js';

function errorFrom(fn: () => unknown): VisualRegressionError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(VisualRegressionError);
    return error as VisualRegressionError;
  }
  throw new Error('expected function to throw');
}

describe('screenshotNameForRoute', () => {
  it('maps the root route to home.png', () => {
    expect(screenshotNameForRoute('/')).toBe('home.png');
  });

  it('names a single-segment route', () => {
    expect(screenshotNameForRoute('/about')).toBe('about.png');
  });

  it('keeps numeric error pages', () => {
    expect(screenshotNameForRoute('/404')).toBe('404.png');
    expect(screenshotNameForRoute('/500')).toBe('500.png');
  });

  it('joins nested segments with --', () => {
    expect(screenshotNameForRoute('/docs/getting-started')).toBe('docs--getting-started.png');
    expect(screenshotNameForRoute('/a/b/c')).toBe('a--b--c.png');
  });

  it('keeps [A-Za-z0-9._-] characters literal', () => {
    expect(screenshotNameForRoute('/v1.2_beta-x')).toBe('v1.2_beta-x.png');
  });

  it('encodes ASCII characters outside the allowed set as _XX_', () => {
    expect(screenshotNameForRoute('/a b')).toBe('a_20_b.png');
    expect(screenshotNameForRoute('/a+b')).toBe('a_2B_b.png');
    expect(screenshotNameForRoute('/a:b')).toBe('a_3A_b.png');
  });

  it('encodes unicode as one _XX_ escape per UTF-8 byte', () => {
    expect(screenshotNameForRoute('/café')).toBe('caf_C3__A9_.png');
    expect(screenshotNameForRoute('/日本語')).toBe('_E6__97__A5__E6__9C__AC__E8__AA__9E_.png');
  });

  it('encodes astral-plane code points (emoji) portably', () => {
    expect(screenshotNameForRoute('/😀')).toBe('_F0__9F__98__80_.png');
  });

  it('is deterministic', () => {
    expect(screenshotNameForRoute('/café')).toBe(screenshotNameForRoute('/café'));
  });

  it('produces names containing no path separators', () => {
    const name = screenshotNameForRoute('/a/b/c d/é');
    expect(name).not.toMatch(/[/\\]/);
    expect(name.endsWith('.png')).toBe(true);
  });

  describe('long names', () => {
    it('caps names at 180 chars with an 8-char sha256 suffix', () => {
      const route = `/${'a'.repeat(300)}`;
      const name = screenshotNameForRoute(route);
      expect(name).toHaveLength(180);
      expect(name).toMatch(/^a+-[0-9a-f]{8}\.png$/);
    });

    it('keeps names at exactly 180 chars untruncated', () => {
      const route = `/${'a'.repeat(176)}`; // 176 + '.png' = 180
      expect(screenshotNameForRoute(route)).toBe(`${'a'.repeat(176)}.png`);
    });

    it('distinguishes long routes that share a 180-char prefix', () => {
      const shared = 'a'.repeat(250);
      const nameX = screenshotNameForRoute(`/${shared}x`);
      const nameY = screenshotNameForRoute(`/${shared}y`);
      expect(nameX).not.toBe(nameY);
    });

    it('is deterministic when truncating', () => {
      const route = `/${'z'.repeat(500)}`;
      expect(screenshotNameForRoute(route)).toBe(screenshotNameForRoute(route));
    });
  });

  describe('invalid routes', () => {
    const invalid = [
      ['relative path', 'about'],
      ['windows absolute path', 'C:\\pages\\about'],
      ['windows forward-slash absolute path', 'C:/pages/about'],
      ['backslash inside route', '/a\\b'],
      ['parent traversal segment', '/a/../b'],
      ['bare traversal', '/..'],
      ['dotted traversal in segment', '/a..b'],
      ['empty string', ''],
      ['slashes only', '//'],
      ['many slashes', '///'],
      ['dot-only segment', '/.'],
      ['nested dot-only segment', '/a/./b'],
    ] as const;

    it.each(invalid)('rejects %s with SCREENSHOT_NAME_INVALID', (_label, route) => {
      const error = errorFrom(() => screenshotNameForRoute(route));
      expect(error.code).toBe('SCREENSHOT_NAME_INVALID');
      expect(error.context['route']).toBe(route);
    });
  });
});

describe('assignScreenshotNames', () => {
  it('sorts routes lexicographically and dedupes exact duplicates', () => {
    const descriptors = assignScreenshotNames(['/b', '/a', '/b', '/']);
    expect(descriptors).toEqual([
      { route: '/', screenshotName: 'home.png' },
      { route: '/a', screenshotName: 'a.png' },
      { route: '/b', screenshotName: 'b.png' },
    ]);
  });

  it('preserves the original route string on each descriptor', () => {
    const descriptors = assignScreenshotNames(['/café', '/']);
    expect(descriptors.map((d) => d.route)).toEqual(['/', '/café']);
    expect(descriptors[1]?.screenshotName).toBe('caf_C3__A9_.png');
  });

  it('detects case-insensitive collisions and names both routes', () => {
    const error = errorFrom(() => assignScreenshotNames(['/About', '/about']));
    expect(error.code).toBe('SCREENSHOT_NAME_COLLISION');
    expect(error.message).toContain('/About');
    expect(error.message).toContain('/about');
    expect([error.context['route'], error.context['conflictingRoute']].sort()).toEqual([
      '/About',
      '/about',
    ]);
  });

  it('detects collisions between nested segments and literal -- in a segment', () => {
    const error = errorFrom(() => assignScreenshotNames(['/a/b', '/a--b']));
    expect(error.code).toBe('SCREENSHOT_NAME_COLLISION');
  });

  it('detects collisions between encoded characters and literal escapes', () => {
    // '/a b' encodes to 'a_20_b.png'; '/a_20_b' produces it literally.
    const error = errorFrom(() => assignScreenshotNames(['/a b', '/a_20_b']));
    expect(error.code).toBe('SCREENSHOT_NAME_COLLISION');
  });

  it('propagates SCREENSHOT_NAME_INVALID for bad routes', () => {
    const error = errorFrom(() => assignScreenshotNames(['/ok', '/../etc']));
    expect(error.code).toBe('SCREENSHOT_NAME_INVALID');
  });

  it('returns an empty list for no routes', () => {
    expect(assignScreenshotNames([])).toEqual([]);
  });
});
