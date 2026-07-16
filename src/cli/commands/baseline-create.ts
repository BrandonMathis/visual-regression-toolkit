import path from 'node:path';
import { createBaseline, verifyBaseline } from '../../baseline/index.js';
import { computeVisualContractHash, loadConfig } from '../../config/index.js';
import { BASELINE_OUT_DIR, RESULT_DIR } from '../../paths.js';
import { writeResult } from '../../result/index.js';
import { VISUAL_RESULT_SCHEMA_VERSION, hostEnvironment } from '../../runtime.js';
import type { VisualResult } from '../../types.js';
import { environmentIdentity, resolveRunIdentity } from '../identity.js';
import type { Logger } from '../logger.js';
import { buildDiscoverCapture } from '../pipeline.js';
import {
  HOST_WARNING,
  buildFailureResult,
  emitJson,
  resultReports,
  runtimeBlock,
  toVisualError,
  writeResultBestEffort,
} from '../shared.js';

export interface BaselineCreateOptions {
  configPath: string;
  host: boolean;
  json: boolean;
}

export async function runBaselineCreate(
  options: BaselineCreateOptions,
  logger: Logger,
): Promise<number> {
  const repoRoot = process.cwd();
  if (options.host) {
    logger.warn(HOST_WARNING);
  }

  let visualContractHash: string | null = null;
  let candidateSha: string | null = null;
  let routeCount = 0;
  try {
    const config = await loadConfig(path.resolve(repoRoot, options.configPath), repoRoot);
    visualContractHash = computeVisualContractHash(config);
    const identity = await resolveRunIdentity(repoRoot);
    candidateSha = identity.sourceSha;
    const logicalDate = new Date().toISOString();

    const { routes, screenshotsDir } = await buildDiscoverCapture({
      repoRoot,
      config,
      logicalDate,
      host: options.host,
      logger,
      onRoutes: (discovered) => {
        routeCount = discovered.length;
      },
    });

    const baselineDir = path.resolve(repoRoot, BASELINE_OUT_DIR);
    const { os, arch } = hostEnvironment();
    const { containerDigest, platform } = environmentIdentity(options.host);
    const manifest = await createBaseline({
      screenshotsDir,
      baselineDir,
      routes,
      projects: config.projects,
      identity: {
        repository: identity.repository,
        baseBranch: identity.baseBranch,
        sourceSha: identity.sourceSha,
        workflowRunId: identity.workflowRunId,
        workflowRunAttempt: identity.attempt,
        createdAt: new Date().toISOString(),
        logicalDate,
      },
      environment: { os, arch, containerDigest, platform },
      visualContractHash,
    });
    await verifyBaseline(baselineDir);

    const result: VisualResult = {
      schemaVersion: VISUAL_RESULT_SCHEMA_VERSION,
      operation: 'baseline-create',
      status: 'pass',
      createdAt: new Date().toISOString(),
      candidateSha,
      baseline: null,
      visualContractHash,
      runtime: runtimeBlock(options.host),
      totals: {
        routes: routes.length,
        screenshots: manifest.screenshots.length,
        changed: 0,
        added: 0,
        removed: 0,
      },
      comparisons: [],
      errors: [],
      reports: resultReports({ htmlReady: true }),
    };
    await writeResult(path.resolve(repoRoot, RESULT_DIR), result);
    logger.info(`Baseline created and verified at ${baselineDir}`);
    if (options.json) {
      emitJson(result);
    }
    return 0;
  } catch (error) {
    const visualError = toVisualError(error);
    logger.error(`${visualError.code}: ${visualError.message}`);
    const result = buildFailureResult({
      operation: 'baseline-create',
      error: visualError,
      host: options.host,
      candidateSha,
      visualContractHash,
      baseline: null,
      totals: { routes: routeCount },
    });
    await writeResultBestEffort(repoRoot, result, logger);
    if (options.json) {
      emitJson(result);
    }
    return 1;
  }
}
