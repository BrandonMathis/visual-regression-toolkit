import path from 'node:path';
import { verifyBaseline } from '../../baseline/index.js';
import type { Logger } from '../logger.js';
import { emitJson, toVisualError } from '../shared.js';

export interface BaselineVerifyOptions {
  dir: string;
  json: boolean;
}

export async function runBaselineVerify(
  options: BaselineVerifyOptions,
  logger: Logger,
): Promise<number> {
  const repoRoot = process.cwd();
  try {
    const manifest = await verifyBaseline(path.resolve(repoRoot, options.dir));
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
