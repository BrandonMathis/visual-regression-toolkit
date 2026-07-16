import type { ResolvedProject, RouteDescriptor } from '../types.js';
import type { CaptureOptions } from './playwright.js';

/**
 * Bounded timeouts for every awaited capture step (plan §7: "All waits
 * require bounded timeouts"). testMs is the per-test Playwright timeout.
 */
export const CAPTURE_TIMEOUTS = {
  testMs: 90_000,
  navigationMs: 30_000,
  actionMs: 15_000,
  expectMs: 10_000,
  readinessMs: 15_000,
  stepMs: 30_000,
  screenshotMs: 30_000,
} as const;

export type CaptureTimeouts = typeof CAPTURE_TIMEOUTS;

/**
 * Everything the generated (plain .mjs, no TS build) Playwright suite needs,
 * written to payload.json inside the temporary config directory.
 */
export interface CapturePayload {
  origin: string;
  routes: RouteDescriptor[];
  projects: ResolvedProject[];
  /** Absolute dir receiving screenshots/<project>/<screenshotName>. */
  screenshotsDir: string;
  capture: {
    colorScheme: 'light' | 'dark';
    locale: string;
    timezoneId: string;
    reducedMotion: 'reduce' | 'no-preference';
    fontChecks: string[];
    readinessSelectors: string[];
    masks: string[];
    fullPage: boolean;
  };
  /** Compiled external-request policy: 'self' is resolved to the server origin. */
  network: {
    allowAll: boolean;
    allowedOrigins: string[];
  };
  timeouts: CaptureTimeouts;
}

export interface GeneratedConfigPaths {
  /** Absolute dir for the Playwright HTML report. */
  playwrightReportDir: string;
  /** Absolute dir for Playwright test-results (traces on failure). */
  testResultsDir: string;
  /** Absolute path of the machine-readable JSON report inside the temp dir. */
  reportJsonPath: string;
}

function compileAllowedOrigins(serverOrigin: string, allow: string[]): string[] {
  // The server origin, data:, and blob: are always allowed (plan §7 step 2);
  // 'self', 'data:', and 'blob:' list literals are therefore already covered.
  const origins = new Set<string>([new URL(serverOrigin).origin]);
  for (const entry of allow) {
    if (entry === 'self' || entry === 'data:' || entry === 'blob:') {
      continue;
    }
    try {
      origins.add(new URL(entry).origin);
    } catch {
      // Config validation rejects malformed origins; never widen the policy here.
    }
  }
  return [...origins].sort();
}

export function buildCapturePayload(options: CaptureOptions): CapturePayload {
  const { config } = options;
  return {
    origin: new URL(config.server.origin).origin,
    routes: options.routes,
    projects: config.projects,
    screenshotsDir: options.screenshotsDir,
    capture: {
      colorScheme: config.capture.colorScheme,
      locale: config.capture.locale,
      timezoneId: config.capture.timezoneId,
      reducedMotion: config.capture.reducedMotion,
      fontChecks: config.capture.fontChecks,
      readinessSelectors: config.capture.readinessSelectors,
      masks: config.capture.masks,
      fullPage: config.capture.screenshot.fullPage,
    },
    network: {
      allowAll: config.capture.externalRequests.default === 'allow',
      allowedOrigins: compileAllowedOrigins(
        config.server.origin,
        config.capture.externalRequests.allow,
      ),
    },
    timeouts: CAPTURE_TIMEOUTS,
  };
}

/**
 * Emit playwright.config.mjs as a plain default-exported object (no imports,
 * so the temp dir needs no module resolution). One Playwright project per
 * ResolvedProject; workers 1 / retries 0 / fullyParallel false for
 * determinism. Never reads or merges any consumer Playwright configuration.
 */
export function generatePlaywrightConfig(
  payload: CapturePayload,
  paths: GeneratedConfigPaths,
): string {
  const totalTests = payload.routes.length * payload.projects.length;
  const config = {
    testDir: '.',
    testMatch: 'visual.spec.mjs',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: payload.timeouts.testMs,
    globalTimeout: totalTests * payload.timeouts.testMs + 120_000,
    expect: { timeout: payload.timeouts.expectMs },
    outputDir: paths.testResultsDir,
    reporter: [
      ['html', { outputFolder: paths.playwrightReportDir, open: 'never' }],
      ['json', { outputFile: paths.reportJsonPath }],
    ],
    use: {
      browserName: 'chromium',
      locale: payload.capture.locale,
      timezoneId: payload.capture.timezoneId,
      colorScheme: payload.capture.colorScheme,
      reducedMotion: payload.capture.reducedMotion,
      serviceWorkers: 'block',
      trace: 'retain-on-failure',
      actionTimeout: payload.timeouts.actionMs,
      navigationTimeout: payload.timeouts.navigationMs,
    },
    projects: payload.projects.map((project) => ({
      name: project.name,
      use: {
        viewport: { width: project.width, height: project.height },
        deviceScaleFactor: project.deviceScaleFactor,
        hasTouch: project.hasTouch,
        isMobile: project.isMobile,
      },
    })),
  };
  return `export default ${JSON.stringify(config, null, 2)};\n`;
}
