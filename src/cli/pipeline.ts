import path from 'node:path';
import { captureRoutes, runBuild, startServer } from '../capture/index.js';
import { discoverRoutes } from '../discovery/index.js';
import { CANDIDATE_SCREENSHOTS_DIR, PLAYWRIGHT_REPORT_DIR, TEST_RESULTS_DIR } from '../paths.js';
import type { ResolvedVisualConfig, RouteDescriptor } from '../types.js';
import type { Logger } from './logger.js';
import { clearOutputDirs } from './shared.js';

export interface CapturePipelineInputs {
  repoRoot: string;
  config: ResolvedVisualConfig;
  /** Injected into the configured clock env var for build, start, and capture. */
  logicalDate: string;
  host: boolean;
  logger: Logger;
  /** Invoked once routes are known so failures can report partial totals. */
  onRoutes?: (routes: RouteDescriptor[]) => void;
}

export interface CapturePipelineOutput {
  routes: RouteDescriptor[];
  /** Absolute dir holding screenshots/<project>/<screenshotName>. */
  screenshotsDir: string;
}

/**
 * The shared build -> discover -> start -> capture sequence used by both
 * baseline create and compare. Clears the fixed output dirs first and always
 * stops the server, restoring the clock env var afterwards.
 */
export async function buildDiscoverCapture(
  inputs: CapturePipelineInputs,
): Promise<CapturePipelineOutput> {
  const { repoRoot, config, logicalDate, host, logger } = inputs;
  await clearOutputDirs(repoRoot);

  const clockVar = config.clock.environmentVariable;
  const env = { [clockVar]: logicalDate };
  const previousClockValue = process.env[clockVar];
  // The Playwright child process inherits process.env, so the logical date
  // must be present there as well as in the build/start env.
  process.env[clockVar] = logicalDate;
  try {
    logger.info('Running production build');
    await runBuild(config, env);

    const routes = await discoverRoutes(config);
    inputs.onRoutes?.(routes);
    logger.info(`Discovered ${routes.length} route(s), ${config.projects.length} project(s)`);

    const screenshotsDir = path.resolve(repoRoot, CANDIDATE_SCREENSHOTS_DIR);
    logger.info('Starting application server');
    const server = await startServer(config, env);
    try {
      logger.info('Capturing screenshots');
      await captureRoutes({
        config,
        routes,
        screenshotsDir,
        logicalDate,
        host,
        playwrightReportDir: path.resolve(repoRoot, PLAYWRIGHT_REPORT_DIR),
        testResultsDir: path.resolve(repoRoot, TEST_RESULTS_DIR),
      });
    } finally {
      await server.stop();
    }
    return { routes, screenshotsDir };
  } finally {
    if (previousClockValue === undefined) {
      delete process.env[clockVar];
    } else {
      process.env[clockVar] = previousClockValue;
    }
  }
}
