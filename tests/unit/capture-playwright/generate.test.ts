import { describe, expect, it } from 'vitest';
import {
  buildCapturePayload,
  CAPTURE_TIMEOUTS,
  generatePlaywrightConfig,
  type CapturePayload,
} from '../../../src/capture/generate.js';
import { generateVisualSpec } from '../../../src/capture/stabilize.js';
import type { CaptureOptions } from '../../../src/capture/playwright.js';
import { DESKTOP, PHONE, makeResolvedConfig } from './fixtures.js';

function makeOptions(overrides: Partial<CaptureOptions> = {}): CaptureOptions {
  return {
    config: makeResolvedConfig(),
    routes: [
      { route: '/', screenshotName: 'home.png' },
      { route: '/about', screenshotName: 'about.png' },
    ],
    screenshotsDir: '/out/screenshots',
    logicalDate: '2026-01-01',
    host: false,
    playwrightReportDir: '/out/playwright-report',
    testResultsDir: '/out/test-results',
    ...overrides,
  };
}

describe('buildCapturePayload', () => {
  it('carries origin, routes, projects, capture settings, and screenshots dir', () => {
    const options = makeOptions();
    const payload = buildCapturePayload(options);
    expect(payload.origin).toBe('http://127.0.0.1:3000');
    expect(payload.routes).toEqual(options.routes);
    expect(payload.projects).toEqual([DESKTOP, PHONE]);
    expect(payload.screenshotsDir).toBe('/out/screenshots');
    expect(payload.capture.fullPage).toBe(true);
    expect(payload.timeouts).toEqual(CAPTURE_TIMEOUTS);
  });

  it('compiles the block policy: self resolves to the server origin', () => {
    const payload = buildCapturePayload(makeOptions());
    expect(payload.network.allowAll).toBe(false);
    expect(payload.network.allowedOrigins).toEqual(['http://127.0.0.1:3000']);
  });

  it('adds extra allowed origins, normalized and deduplicated', () => {
    const config = makeResolvedConfig({
      capture: {
        externalRequests: {
          default: 'block',
          allow: ['self', 'data:', 'blob:', 'https://fonts.example.com/some/path', 'self'],
        },
      },
    });
    const payload = buildCapturePayload(makeOptions({ config }));
    expect(payload.network.allowedOrigins).toEqual([
      'http://127.0.0.1:3000',
      'https://fonts.example.com',
    ]);
  });

  it('inverts to allow-all when externalRequests.default is allow', () => {
    const config = makeResolvedConfig({
      capture: { externalRequests: { default: 'allow', allow: ['self'] } },
    });
    const payload = buildCapturePayload(makeOptions({ config }));
    expect(payload.network.allowAll).toBe(true);
  });

  it('copies font checks, readiness selectors, and masks', () => {
    const config = makeResolvedConfig({
      capture: {
        fontChecks: ['Inter'],
        readinessSelectors: ['main'],
        masks: ['.ad', '[data-dynamic]'],
      },
    });
    const payload = buildCapturePayload(makeOptions({ config }));
    expect(payload.capture.fontChecks).toEqual(['Inter']);
    expect(payload.capture.readinessSelectors).toEqual(['main']);
    expect(payload.capture.masks).toEqual(['.ad', '[data-dynamic]']);
  });

  it('bounds every timeout', () => {
    for (const value of Object.values(CAPTURE_TIMEOUTS)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(90_000);
    }
  });
});

describe('generatePlaywrightConfig', () => {
  const paths = {
    playwrightReportDir: '/out/playwright-report',
    testResultsDir: '/out/test-results',
    reportJsonPath: '/tmp/capture/report.json',
  };

  function parseConfig(payload: CapturePayload): Record<string, unknown> {
    const source = generatePlaywrightConfig(payload, paths);
    expect(source.startsWith('export default ')).toBe(true);
    return JSON.parse(source.replace(/^export default /, '').replace(/;\s*$/, '')) as Record<
      string,
      unknown
    >;
  }

  it('maps every resolved project to a Playwright project', () => {
    const config = parseConfig(buildCapturePayload(makeOptions()));
    expect(config['projects']).toEqual([
      {
        name: 'desktop',
        use: {
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          hasTouch: false,
          isMobile: false,
        },
      },
      {
        name: 'phone',
        use: {
          viewport: { width: 375, height: 812 },
          deviceScaleFactor: 2,
          hasTouch: true,
          isMobile: true,
        },
      },
    ]);
  });

  it('enforces deterministic execution settings', () => {
    const config = parseConfig(buildCapturePayload(makeOptions()));
    expect(config['workers']).toBe(1);
    expect(config['retries']).toBe(0);
    expect(config['fullyParallel']).toBe(false);
    expect(config['timeout']).toBe(90_000);
    expect(config['expect']).toEqual({ timeout: CAPTURE_TIMEOUTS.expectMs });
  });

  it('configures shared use: chromium, media settings, blocked service workers, traces', () => {
    const config = parseConfig(buildCapturePayload(makeOptions()));
    expect(config['use']).toEqual({
      browserName: 'chromium',
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      trace: 'retain-on-failure',
      actionTimeout: CAPTURE_TIMEOUTS.actionMs,
      navigationTimeout: CAPTURE_TIMEOUTS.navigationMs,
    });
  });

  it('wires reporters and output dirs to the given paths', () => {
    const config = parseConfig(buildCapturePayload(makeOptions()));
    expect(config['reporter']).toEqual([
      ['html', { outputFolder: paths.playwrightReportDir, open: 'never' }],
      ['json', { outputFile: paths.reportJsonPath }],
    ]);
    expect(config['outputDir']).toBe(paths.testResultsDir);
  });

  it('bounds the global timeout by the number of route/project pairs', () => {
    const payload = buildCapturePayload(makeOptions());
    const config = parseConfig(payload);
    expect(config['globalTimeout']).toBe(2 * 2 * 90_000 + 120_000);
  });
});

describe('generateVisualSpec', () => {
  const importUrl = 'file:///toolkit/node_modules/@playwright/test/index.mjs';
  const spec = generateVisualSpec(importUrl);

  it('imports the pinned @playwright/test by absolute URL and reads payload.json', () => {
    expect(spec).toContain(`import { test } from "${importUrl}";`);
    expect(spec).toContain("new URL('./payload.json', import.meta.url)");
  });

  it('contains the 13 stabilization steps in order inside the test body', () => {
    const bodyStart = spec.indexOf("test('visual ' + route.route");
    expect(bodyStart).toBeGreaterThan(-1);
    const orderedMarkers = [
      "page.route('**/*'", // 2: request blocking
      'page.goto(', // 3: navigation
      "waitFor({ state: 'visible'", // 4: readiness selectors
      'await awaitFonts(page', // 5: fonts
      'page.addStyleTag(', // 6: animation/caret freeze
      'img[loading="lazy"]', // 7: eager lazy images
      'window.scrollTo(0, offset)', // 8: incremental scroll
      'await assertRequiredImages(page', // 9: decode + broken resources
      "querySelectorAll('video')", // 10: video stabilization
      'window.scrollTo(0, 0)', // 11: back to top
      'await awaitFonts(page', // 12a: font re-check
      'await assertRequiredImages(page', // 12b: image re-check
      'page.screenshot(', // 13: single screenshot
    ];
    let cursor = bodyStart;
    for (const marker of orderedMarkers) {
      const index = spec.indexOf(marker, cursor + 1);
      expect(index, `marker not found in order: ${marker}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('compiles the blocking policy with same-origin, data:, blob:, and allow-list checks', () => {
    expect(spec).toContain('payload.network.allowAll');
    expect(spec).toContain("url.startsWith('data:')");
    expect(spec).toContain("url.startsWith('blob:')");
    expect(spec).toContain('payload.network.allowedOrigins.includes(new URL(url).origin)');
    expect(spec).toContain('intercepted.abort()');
  });

  it('requires an ok navigation response and tags failures for the runner', () => {
    expect(spec).toContain('!response.ok()');
    for (const code of [
      'NAVIGATION_FAILED',
      'READINESS_TIMEOUT',
      'FONT_CHECK_FAILED',
      'RESOURCE_BROKEN',
      'CAPTURE_FAILED',
    ]) {
      expect(spec).toContain(`'${code}'`);
    }
    expect(spec).toContain("'VR:' + code + ' route=' + route + ' project=' + project");
  });

  it('disables animations, transitions, carets, and smooth scrolling', () => {
    expect(spec).toContain('animation: none !important');
    expect(spec).toContain('transition: none !important');
    expect(spec).toContain('caret-color: transparent !important');
    expect(spec).toContain('scroll-behavior: auto !important');
  });

  it('only counts broken images whose src is same-origin or allowed', () => {
    expect(spec).toContain("image.currentSrc !== ''");
    expect(spec).toContain('image.naturalWidth === 0');
    expect(spec).toContain('isRequired(image.currentSrc)');
    expect(spec).toContain('new URL(src, window.location.href).origin');
  });

  it('takes exactly one screenshot with masks, disabled animations, and css scale', () => {
    expect(spec.split('page.screenshot(').length - 1).toBe(1);
    expect(spec).toContain('payload.capture.masks.map((selector) => page.locator(selector))');
    expect(spec).toContain("animations: 'disabled'");
    expect(spec).toContain("caret: 'hide'");
    expect(spec).toContain("scale: 'css'");
    expect(spec).toContain('fullPage: payload.capture.fullPage');
    expect(spec).toContain('join(payload.screenshotsDir, project, route.screenshotName)');
  });

  it('bounds every awaited stabilization step', () => {
    expect(spec).toContain('async function bounded(promise, ms, makeError)');
    expect(spec).toContain('timeout: payload.timeouts.navigationMs');
    expect(spec).toContain('timeout: payload.timeouts.readinessMs');
    expect(spec).toContain('timeout: payload.timeouts.screenshotMs');
    expect(spec.split('payload.timeouts.stepMs').length - 1).toBeGreaterThanOrEqual(4);
  });
});
