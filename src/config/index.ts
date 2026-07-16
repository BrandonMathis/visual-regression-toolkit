/**
 * Configuration loading, validation, normalization, and visual-contract
 * hashing (plan §5.2, §5.3).
 *
 * IMPLEMENTATION CONTRACT (agent: replace bodies, keep signatures):
 * - loadConfig: load a TS/JS config file via jiti, unwrap default export,
 *   then resolveConfig. Missing file -> CONFIG_NOT_FOUND.
 * - resolveConfig: strict zod validation (reject unknown fields, invalid
 *   selectors/origins/globs/project names, unsafe paths, duplicate project
 *   names, non-loopback origins), apply defaults (DEFAULT_PROJECTS etc.),
 *   resolve paths against repoRoot, normalize order-independent values.
 *   Failures -> CONFIG_INVALID with actionable messages; never log env values.
 * - computeVisualContractHash: sha256 hex of a canonical JSON of every
 *   pixel/comparison-affecting setting plus stabilization/adapter behavior
 *   versions; excludes routes, SHAs, timestamps, output dirs (plan §5.3).
 */
import type { ResolvedVisualConfig, VisualRegressionConfig } from '../types.js';

/** Identity helper giving consumers config typing (public API). */
export function defineVisualConfig(config: VisualRegressionConfig): VisualRegressionConfig {
  return config;
}

export async function loadConfig(
  configPath: string,
  repoRoot: string,
): Promise<ResolvedVisualConfig> {
  void configPath;
  void repoRoot;
  throw new Error('not implemented');
}

export function resolveConfig(
  raw: unknown,
  options: { repoRoot: string; configPath: string },
): ResolvedVisualConfig {
  void raw;
  void options;
  throw new Error('not implemented');
}

export function computeVisualContractHash(config: ResolvedVisualConfig): string {
  void config;
  throw new Error('not implemented');
}
