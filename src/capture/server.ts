import type { ResolvedVisualConfig } from '../types.js';

export interface RunningServer {
  origin: string;
  stop(): Promise<void>;
}

/**
 * Run config.commands.build in config.repoRoot with `env` merged over a
 * sanitized process env. Streams output to stderr. Non-zero exit ->
 * BUILD_FAILED.
 */
export async function runBuild(
  config: ResolvedVisualConfig,
  env: Record<string, string>,
): Promise<void> {
  void config;
  void env;
  throw new Error('not implemented');
}

/**
 * Start config.commands.start, poll `${origin}${readinessPath}` until an
 * HTTP < 500 response or startupTimeoutMs elapses. Always kill the process
 * tree on failure, stop(), and SIGINT/SIGTERM.
 */
export async function startServer(
  config: ResolvedVisualConfig,
  env: Record<string, string>,
): Promise<RunningServer> {
  void config;
  void env;
  throw new Error('not implemented');
}
