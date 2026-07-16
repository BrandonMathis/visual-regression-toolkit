import path from 'node:path';
import { verifyBaseline } from '../../baseline/index.js';
import { VisualRegressionError } from '../../errors.js';
import {
  BASELINE_MANIFEST_SCHEMA_VERSION,
  CHROMIUM_REVISION,
  CONTAINER_DIGEST,
  PLAYWRIGHT_VERSION,
  toolkitMajor,
} from '../../runtime.js';
import type { BaselineManifest } from '../../types.js';
import type { Logger } from '../logger.js';
import { emitJson, toVisualError } from '../shared.js';

export interface BaselineVerifyOptions {
  dir: string;
  json: boolean;
}

/**
 * Plan §5.4: baseline verify validates compatibility with the CURRENT toolkit
 * runtime in addition to structural integrity. Fields that need candidate
 * context (repository, sourceSha, visualContractHash) are enforced later by
 * compare, which has that context.
 */
function checkRuntimeCompatibility(manifest: BaselineManifest, logger: Logger): void {
  const mismatched: { field: string; expected: string; actual: string }[] = [];

  const actualToolkitMajor = Number.parseInt(manifest.toolkit.version.split('.')[0] ?? '', 10);
  if (actualToolkitMajor !== toolkitMajor()) {
    mismatched.push({
      field: 'toolkitMajor',
      expected: String(toolkitMajor()),
      actual: String(actualToolkitMajor),
    });
  }
  if (manifest.schemaVersion !== BASELINE_MANIFEST_SCHEMA_VERSION) {
    mismatched.push({
      field: 'schemaVersion',
      expected: String(BASELINE_MANIFEST_SCHEMA_VERSION),
      actual: String(manifest.schemaVersion),
    });
  }
  if (manifest.playwrightVersion !== PLAYWRIGHT_VERSION) {
    mismatched.push({
      field: 'playwrightVersion',
      expected: PLAYWRIGHT_VERSION,
      actual: manifest.playwrightVersion,
    });
  }
  if (manifest.chromiumRevision !== CHROMIUM_REVISION) {
    mismatched.push({
      field: 'chromiumRevision',
      expected: CHROMIUM_REVISION,
      actual: manifest.chromiumRevision,
    });
  }
  const containerDigest = manifest.environment.containerDigest;
  if (containerDigest === 'host') {
    logger.warn(
      'Baseline was captured on a host environment: it is diagnostic-only and NOT comparable to CI baselines.',
    );
  } else if (containerDigest !== CONTAINER_DIGEST) {
    mismatched.push({
      field: 'containerDigest',
      expected: `${CONTAINER_DIGEST} or 'host'`,
      actual: containerDigest,
    });
  }

  if (mismatched.length === 0) {
    return;
  }
  const description = mismatched
    .map(
      (comparison) =>
        `${comparison.field} (expected ${comparison.expected}, actual ${comparison.actual})`,
    )
    .join('; ');
  throw new VisualRegressionError(
    'BASELINE_INCOMPATIBLE',
    `Baseline is incompatible with this toolkit runtime: ${description}`,
    { context: { mismatched: description } },
  );
}

export async function runBaselineVerify(
  options: BaselineVerifyOptions,
  logger: Logger,
): Promise<number> {
  const repoRoot = process.cwd();
  try {
    const manifest = await verifyBaseline(path.resolve(repoRoot, options.dir));
    checkRuntimeCompatibility(manifest, logger);
    if (options.json) {
      emitJson({
        status: 'ok',
        sourceSha: manifest.sourceSha,
        visualContractHash: manifest.visualContractHash,
        toolkitVersion: manifest.toolkit.version,
        screenshots: manifest.screenshots.length,
      });
    } else {
      const summary = [
        'baseline: ok',
        `repository: ${manifest.repository}`,
        `sourceSha: ${manifest.sourceSha}`,
        `visualContractHash: ${manifest.visualContractHash}`,
        `toolkit: ${manifest.toolkit.name}@${manifest.toolkit.version}`,
        `screenshots: ${manifest.screenshots.length}`,
      ].join('\n');
      process.stdout.write(`${summary}\n`);
    }
    return 0;
  } catch (error) {
    const visualError = toVisualError(error);
    logger.error(`${visualError.code}: ${visualError.message}`);
    return 1;
  }
}
