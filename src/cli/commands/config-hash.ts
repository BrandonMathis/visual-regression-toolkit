import path from 'node:path';
import { computeVisualContractHash, loadConfig } from '../../config/index.js';
import type { Logger } from '../logger.js';
import { emitJson, toVisualError } from '../shared.js';

export interface ConfigHashOptions {
  configPath: string;
  json: boolean;
}

export async function runConfigHash(options: ConfigHashOptions, logger: Logger): Promise<number> {
  const repoRoot = process.cwd();
  try {
    const config = await loadConfig(path.resolve(repoRoot, options.configPath), repoRoot);
    const hash = computeVisualContractHash(config);
    if (options.json) {
      emitJson({ visualContractHash: hash });
    } else {
      process.stdout.write(`${hash}\n`);
    }
    return 0;
  } catch (error) {
    const visualError = toVisualError(error);
    logger.error(`${visualError.code}: ${visualError.message}`);
    return 1;
  }
}
