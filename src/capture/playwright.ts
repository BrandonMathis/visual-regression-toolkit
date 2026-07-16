import type { ResolvedVisualConfig, RouteDescriptor } from '../types.js';

export interface CaptureOptions {
  config: ResolvedVisualConfig;
  routes: RouteDescriptor[];
  /** Absolute dir receiving screenshots/<project>/<screenshotName>. */
  screenshotsDir: string;
  /** ISO date injected as the logical clock (informational; env is set by the caller). */
  logicalDate: string;
  /** True for --host diagnostic runs (never authoritative). */
  host: boolean;
  /** Absolute dir for the Playwright HTML report. */
  playwrightReportDir: string;
  /** Absolute dir for Playwright test-results (traces on failure). */
  testResultsDir: string;
}

/**
 * Generate an isolated temporary Playwright config + spec implementing the
 * plan §7 stabilization sequence for every route/project pair, then run the
 * Playwright CLI against the already-running server. Must not read, replace,
 * or merge with any consumer Playwright configuration.
 */
export async function captureRoutes(options: CaptureOptions): Promise<void> {
  void options;
  throw new Error('not implemented');
}
