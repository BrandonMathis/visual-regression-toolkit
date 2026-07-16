/**
 * Stderr-only logger: stdout is reserved for machine output (--json), so all
 * human-readable logging goes to stderr with a level prefix.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createStderrLogger(): Logger {
  const write = (level: string, message: string): void => {
    process.stderr.write(`[${level}] ${message}\n`);
  };
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}
