import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { VisualRegressionError } from '../errors.js';
import type { ResolvedVisualConfig } from '../types.js';

export interface RunningServer {
  origin: string;
  stop(): Promise<void>;
}

const READINESS_POLL_INTERVAL_MS = 500;
const READINESS_REQUEST_TIMEOUT_MS = 2_000;
const STOP_SIGTERM_GRACE_MS = 5_000;

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

/**
 * v1 is POSIX-only: command strings run through /bin/sh, and cleanup relies
 * on killing the detached process group via kill(-pid). Windows is not
 * supported.
 */
function spawnShell(command: string, cwd: string, env: Record<string, string>): ChildProcess {
  return spawn('/bin/sh', ['-c', command], {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Forward child output to stderr line by line, each line prefixed. */
function prefixLines(stream: Readable | null, prefix: string): void {
  if (stream === null) return;
  stream.setEncoding('utf8');
  let pending = '';
  stream.on('data', (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      process.stderr.write(prefix + pending.slice(0, newline + 1));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (pending !== '') process.stderr.write(prefix + pending + '\n');
  });
}

/**
 * Track child termination. `exit()` returns null while the child is alive;
 * `exited` resolves once (covering both exit and spawn failure).
 */
function watchChild(child: ChildProcess): {
  exited: Promise<ChildExit>;
  exit: () => ChildExit | null;
} {
  let current: ChildExit | null = null;
  const exited = new Promise<ChildExit>((resolve) => {
    child.once('error', (spawnError) => {
      if (current === null) {
        current = { code: null, signal: null, spawnError };
        resolve(current);
      }
    });
    child.once('exit', (code, signal) => {
      if (current === null) {
        current = { code, signal };
        resolve(current);
      }
    });
  });
  return { exited, exit: () => current };
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process group is already gone.
  }
}

function describeExit(exit: ChildExit): string {
  if (exit.spawnError !== undefined) return 'could not be spawned';
  if (exit.signal !== null) return `was killed by signal ${exit.signal}`;
  return `exited with code ${String(exit.code)}`;
}

function exitContext(exit: ChildExit): Record<string, string> {
  const context: Record<string, string> = {};
  if (exit.code !== null) context.exitCode = String(exit.code);
  if (exit.signal !== null) context.signal = exit.signal;
  return context;
}

/**
 * Build and validate the readiness URL. Only loopback http origins are
 * allowed in v1, and the readiness path must not escape that origin.
 */
function readinessUrl(config: ResolvedVisualConfig): URL {
  const { origin, readinessPath } = config.server;
  let base: URL;
  try {
    base = new URL(origin);
  } catch (cause) {
    throw new VisualRegressionError('CONFIG_INVALID', 'server.origin is not a valid URL', {
      context: { origin },
      cause,
    });
  }
  if (base.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(base.hostname)) {
    throw new VisualRegressionError(
      'CONFIG_INVALID',
      'server.origin must be an http loopback origin in v1',
      { context: { origin } },
    );
  }
  const url = new URL(readinessPath, base);
  if (url.origin !== base.origin) {
    throw new VisualRegressionError(
      'CONFIG_INVALID',
      'server.readinessPath must resolve within server.origin',
      { context: { origin, readinessPath } },
    );
  }
  return url;
}

/**
 * Run config.commands.build in config.repoRoot with `env` merged over the
 * process env. Streams output to stderr. Non-zero exit -> BUILD_FAILED.
 */
export async function runBuild(
  config: ResolvedVisualConfig,
  env: Record<string, string>,
): Promise<void> {
  const child = spawnShell(config.commands.build, config.repoRoot, env);
  const { exited } = watchChild(child);
  prefixLines(child.stdout, '[build] ');
  prefixLines(child.stderr, '[build] ');
  const exit = await exited;
  if (exit.code !== 0) {
    throw new VisualRegressionError('BUILD_FAILED', `Build command ${describeExit(exit)}`, {
      context: { command: config.commands.build, ...exitContext(exit) },
      cause: exit.spawnError,
    });
  }
}

/**
 * Start config.commands.start, poll the readiness URL until any HTTP
 * response with status < 500 arrives or startupTimeoutMs elapses. The
 * process group is killed on start failure, readiness timeout, stop(), and
 * SIGINT/SIGTERM.
 */
export async function startServer(
  config: ResolvedVisualConfig,
  env: Record<string, string>,
): Promise<RunningServer> {
  const url = readinessUrl(config);
  const child = spawnShell(config.commands.start, config.repoRoot, env);
  const { exited, exit } = watchChild(child);
  prefixLines(child.stdout, '[server] ');
  prefixLines(child.stderr, '[server] ');

  const onSignal = (signal: NodeJS.Signals): void => {
    removeSignalHandlers();
    killGroup(child, 'SIGKILL');
    process.kill(process.pid, signal);
  };
  const removeSignalHandlers = (): void => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const fail = async (error: VisualRegressionError): Promise<never> => {
    removeSignalHandlers();
    killGroup(child, 'SIGKILL');
    await exited;
    throw error;
  };

  const deadline = Date.now() + config.server.startupTimeoutMs;
  for (;;) {
    const current = exit();
    if (current !== null) {
      return fail(
        new VisualRegressionError(
          'SERVER_START_FAILED',
          `Start command ${describeExit(current)} before the server became ready`,
          {
            context: { command: config.commands.start, ...exitContext(current) },
            cause: current.spawnError,
          },
        ),
      );
    }
    if (Date.now() >= deadline) {
      return fail(
        new VisualRegressionError(
          'SERVER_READINESS_TIMEOUT',
          `Server was not ready within ${String(config.server.startupTimeoutMs)}ms`,
          {
            context: {
              timeoutMs: String(config.server.startupTimeoutMs),
              readinessPath: config.server.readinessPath,
            },
          },
        ),
      );
    }
    try {
      // redirect: 'manual' keeps the poll on the configured loopback origin.
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(READINESS_REQUEST_TIMEOUT_MS),
      });
      void response.body?.cancel();
      if (response.status < 500 && exit() === null) break;
    } catch {
      // Not accepting connections yet; keep polling.
    }
    await sleep(READINESS_POLL_INTERVAL_MS);
  }

  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      removeSignalHandlers();
      killGroup(child, 'SIGTERM');
      const exitedInTime = await Promise.race([
        exited.then(() => true),
        sleep(STOP_SIGTERM_GRACE_MS, false, { ref: false }),
      ]);
      if (exitedInTime !== true) {
        killGroup(child, 'SIGKILL');
        await exited;
      }
    })();
    return stopPromise;
  };

  return { origin: config.server.origin, stop };
}
