/**
 * Configuration loading, validation, normalization, and visual-contract
 * hashing (plan §5.2, §5.3).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { VisualRegressionError } from '../errors.js';
import type { ResolvedVisualConfig, VisualRegressionConfig } from '../types.js';
import { resolveConfig } from './resolve.js';

export { resolveConfig } from './resolve.js';
export { computeVisualContractHash } from './hash.js';

/** Identity helper giving consumers config typing (public API). */
export function defineVisualConfig(config: VisualRegressionConfig): VisualRegressionConfig {
  return config;
}

export async function loadConfig(
  configPath: string,
  repoRoot: string,
): Promise<ResolvedVisualConfig> {
  const absRepoRoot = path.resolve(repoRoot);
  const absConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(absRepoRoot, configPath);

  if (!existsSync(absConfigPath)) {
    throw new VisualRegressionError('CONFIG_NOT_FOUND', `Config file not found: ${absConfigPath}`, {
      context: { configPath: absConfigPath },
    });
  }

  // Caches are disabled so a config edited between runs in one process reloads.
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    fsCache: false,
    moduleCache: false,
  });
  let loaded: unknown;
  try {
    loaded = await jiti.import(absConfigPath);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new VisualRegressionError(
      'CONFIG_INVALID',
      `Failed to evaluate config file ${absConfigPath}: ${message}`,
      { context: { configPath: absConfigPath }, cause },
    );
  }

  return resolveConfig(unwrapDefaultExport(loaded), {
    repoRoot: absRepoRoot,
    configPath: absConfigPath,
  });
}

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (
    moduleValue !== null &&
    typeof moduleValue === 'object' &&
    'default' in (moduleValue as Record<string, unknown>)
  ) {
    return (moduleValue as Record<string, unknown>)['default'];
  }
  return moduleValue;
}
