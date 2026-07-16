import path from 'node:path';
import {
  checkBaselineCompatibility,
  verifyBaseline,
  verifyBaselineAgainstManifest,
} from '../../baseline/index.js';
import { computeVisualContractHash, loadConfig } from '../../config/index.js';
import { DIFFS_DIRNAME, RESULT_DIR } from '../../paths.js';
import { compareAgainstBaseline, writeResult } from '../../result/index.js';
import {
  BASELINE_MANIFEST_SCHEMA_VERSION,
  CHROMIUM_REVISION,
  PLAYWRIGHT_VERSION,
  VISUAL_RESULT_SCHEMA_VERSION,
  toolkitMajor,
} from '../../runtime.js';
import type { VisualResult } from '../../types.js';
import { environmentIdentity, resolveRunIdentity } from '../identity.js';
import type { Logger } from '../logger.js';
import { buildDiscoverCapture } from '../pipeline.js';
import {
  HOST_WARNING,
  assertBaselineDirOutsideOutputs,
  buildFailureResult,
  emitJson,
  resultReports,
  runtimeBlock,
  toVisualError,
  writeResultBestEffort,
} from '../shared.js';

export interface CompareOptions {
  configPath: string;
  baselineDir: string;
  host: boolean;
  json: boolean;
  expectBaseSha?: string;
  expectRepository?: string;
}

export async function runCompare(options: CompareOptions, logger: Logger): Promise<number> {
  const repoRoot = process.cwd();
  if (options.host) {
    logger.warn(HOST_WARNING);
  }

  let visualContractHash: string | null = null;
  let candidateSha: string | null = null;
  let baselineBlock: VisualResult['baseline'] = null;
  let routeCount = 0;
  try {
    const config = await loadConfig(path.resolve(repoRoot, options.configPath), repoRoot);
    visualContractHash = computeVisualContractHash(config);

    assertBaselineDirOutsideOutputs(repoRoot, options.baselineDir);
    const baselineDir = path.resolve(repoRoot, options.baselineDir);
    const manifest = await verifyBaseline(baselineDir);
    baselineBlock = {
      sourceSha: manifest.sourceSha,
      visualContractHash: manifest.visualContractHash,
      toolkitVersion: manifest.toolkit.version,
      playwrightVersion: manifest.playwrightVersion,
      chromiumRevision: manifest.chromiumRevision,
      containerDigest: manifest.environment.containerDigest,
      platform: manifest.environment.platform,
    };

    const identity = await resolveRunIdentity(repoRoot);
    candidateSha = identity.sourceSha;

    // On --host, container identity cannot match a CI baseline; use the
    // manifest's own values so diagnostics can proceed past compatibility.
    let containerIdentity = environmentIdentity(false);
    if (options.host) {
      logger.warn(
        'Runtime identity is not comparable under --host; using the baseline manifest container identity for diagnostics only.',
      );
      containerIdentity = {
        containerDigest: manifest.environment.containerDigest,
        platform: manifest.environment.platform,
      };
    }
    checkBaselineCompatibility(manifest, {
      repository: options.expectRepository ?? identity.repository,
      // Without --expect-base-sha (local runs) the base SHA is not enforced.
      sourceSha: options.expectBaseSha ?? manifest.sourceSha,
      visualContractHash,
      toolkitMajor: toolkitMajor(),
      schemaVersion: BASELINE_MANIFEST_SCHEMA_VERSION,
      playwrightVersion: PLAYWRIGHT_VERSION,
      chromiumRevision: CHROMIUM_REVISION,
      containerDigest: containerIdentity.containerDigest,
      platform: containerIdentity.platform,
    });

    // Plan §9.10: the candidate is built and captured with the baseline's
    // logical date so time-derived content matches.
    const { routes, screenshotsDir } = await buildDiscoverCapture({
      repoRoot,
      config,
      logicalDate: manifest.logicalDate,
      host: options.host,
      logger,
      onRoutes: (discovered) => {
        routeCount = discovered.length;
      },
    });

    // Plan §9.9/§9.11: the consumer's untrusted build/start ran between the
    // first verification and here, so re-verify every baseline screenshot
    // against the manifest retained from that first verification immediately
    // before comparison. Tampering surfaces as BASELINE_CORRUPT / exit 1.
    await verifyBaselineAgainstManifest(baselineDir, manifest);

    const outcome = await compareAgainstBaseline({
      config,
      baselineDir,
      baselineManifest: manifest,
      candidateRoutes: routes,
      candidateScreenshotsDir: screenshotsDir,
      diffDir: path.resolve(repoRoot, RESULT_DIR, DIFFS_DIRNAME),
    });

    const differences = outcome.changed + outcome.added + outcome.removed;
    const status: VisualResult['status'] = differences > 0 ? 'visual-diff' : 'pass';
    const result: VisualResult = {
      schemaVersion: VISUAL_RESULT_SCHEMA_VERSION,
      operation: 'compare',
      status,
      createdAt: new Date().toISOString(),
      candidateSha,
      baseline: baselineBlock,
      visualContractHash,
      runtime: runtimeBlock(options.host),
      totals: {
        routes: routes.length,
        screenshots: routes.length * config.projects.length,
        changed: outcome.changed,
        added: outcome.added,
        removed: outcome.removed,
      },
      comparisons: outcome.entries.filter((entry) => entry.status !== 'unchanged'),
      errors: [],
      reports: resultReports({ htmlReady: true }),
    };
    await writeResult(path.resolve(repoRoot, RESULT_DIR), result);
    logger.info(
      status === 'pass'
        ? 'Comparison complete: no visual differences'
        : `Comparison complete: ${outcome.changed} changed, ${outcome.added} added, ${outcome.removed} removed`,
    );
    if (options.json) {
      emitJson(result);
    }
    return status === 'pass' ? 0 : 2;
  } catch (error) {
    const visualError = toVisualError(error);
    logger.error(`${visualError.code}: ${visualError.message}`);
    const result = buildFailureResult({
      operation: 'compare',
      error: visualError,
      host: options.host,
      candidateSha,
      visualContractHash,
      baseline: baselineBlock,
      totals: { routes: routeCount },
    });
    await writeResultBestEffort(repoRoot, result, logger);
    if (options.json) {
      emitJson(result);
    }
    return 1;
  }
}
