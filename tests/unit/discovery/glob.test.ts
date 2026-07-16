import { describe, expect, it } from 'vitest';
import { matchRouteGlob } from '../../../src/discovery/glob.js';

describe('matchRouteGlob', () => {
  describe('literal patterns', () => {
    it('matches an identical route', () => {
      expect(matchRouteGlob('/about', '/about')).toBe(true);
    });

    it('does not match a different route', () => {
      expect(matchRouteGlob('/about', '/contact')).toBe(false);
    });

    it('anchors the whole route', () => {
      expect(matchRouteGlob('/about-us', '/about')).toBe(false);
      expect(matchRouteGlob('/x/about', '/about')).toBe(false);
    });

    it('treats regex specials as literals', () => {
      expect(matchRouteGlob('/a.b', '/a.b')).toBe(true);
      expect(matchRouteGlob('/aXb', '/a.b')).toBe(false);
      expect(matchRouteGlob('/a+b', '/a+b')).toBe(true);
      expect(matchRouteGlob('/a(b)', '/a(b)')).toBe(true);
      expect(matchRouteGlob('/a|b', '/a|b')).toBe(true);
      expect(matchRouteGlob('/a$b', '/a$b')).toBe(true);
    });
  });

  describe('* (single segment)', () => {
    it('matches any run of characters within a segment', () => {
      expect(matchRouteGlob('/blog/hello', '/blog/*')).toBe(true);
      expect(matchRouteGlob('/blog/', '/blog/*')).toBe(true);
    });

    it('does not cross segment boundaries', () => {
      expect(matchRouteGlob('/blog/a/b', '/blog/*')).toBe(false);
      expect(matchRouteGlob('/blog', '/blog/*')).toBe(false);
    });

    it('matches zero characters', () => {
      expect(matchRouteGlob('/ab', '/a*b')).toBe(true);
      expect(matchRouteGlob('/axyzb', '/a*b')).toBe(true);
    });

    it('works mid-pattern', () => {
      expect(matchRouteGlob('/docs/v2/intro', '/docs/*/intro')).toBe(true);
      expect(matchRouteGlob('/docs/v2/x/intro', '/docs/*/intro')).toBe(false);
    });
  });

  describe('** (across segments)', () => {
    it('matches everything including the root with /**', () => {
      expect(matchRouteGlob('/', '/**')).toBe(true);
      expect(matchRouteGlob('/a', '/**')).toBe(true);
      expect(matchRouteGlob('/a/b/c', '/**')).toBe(true);
    });

    it('matches across segment boundaries', () => {
      expect(matchRouteGlob('/blog/a/b/c', '/blog/**')).toBe(true);
      expect(matchRouteGlob('/blog/a', '/blog/**')).toBe(true);
    });

    it('supports a suffix after **', () => {
      expect(matchRouteGlob('/a/b/c/edit', '/a/**/edit')).toBe(true);
      expect(matchRouteGlob('/a/b/c/view', '/a/**/edit')).toBe(false);
    });
  });

  describe('? (single character)', () => {
    it('matches exactly one non-slash character', () => {
      expect(matchRouteGlob('/a1', '/a?')).toBe(true);
      expect(matchRouteGlob('/a', '/a?')).toBe(false);
      expect(matchRouteGlob('/a12', '/a?')).toBe(false);
    });

    it('never matches a slash', () => {
      expect(matchRouteGlob('/a/b', '/a?b')).toBe(false);
    });
  });

  it('matches unicode routes literally', () => {
    expect(matchRouteGlob('/café', '/café')).toBe(true);
    expect(matchRouteGlob('/café', '/caf*')).toBe(true);
  });
});
