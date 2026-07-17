import { spawn, type ChildProcess } from "node:child_process";
import { VisualRegressionError } from "../contracts/error-codes.js";

export function spawnCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  detached = false,
): ChildProcess {
  return spawn(command, {
    cwd,
    env,
    shell: true,
    detached,
    stdio: ["ignore", process.stderr, process.stderr],
  });
}
export async function runCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 600_000,
): Promise<void> {
  const child = spawnCommand(command, cwd, env, process.platform !== "win32");
  const shutdown = (signal: NodeJS.Signals): void => {
    void stopProcess(child).finally(() => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.kill(process.pid, signal);
    });
  };
  const interrupt = (): void => {
    shutdown("SIGINT");
  };
  const terminate = (): void => {
    shutdown("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      new Promise<{ type: "exit"; code: number | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve({ type: "exit", code }));
      }),
      new Promise<{ type: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
      }),
    ]);
    if (outcome.type === "timeout") {
      await stopProcess(child);
      throw new VisualRegressionError(
        "BUILD_FAILED",
        `Build command exceeded ${String(timeoutMs)}ms`,
        true,
      );
    }
    if (outcome.code !== 0)
      throw new VisualRegressionError(
        "BUILD_FAILED",
        `Build command exited with code ${String(outcome.code)}`,
      );
  } finally {
    if (timer) clearTimeout(timer);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
export async function stopProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (process.platform === "win32" || !pid) {
    if (child.exitCode !== null || child.signalCode) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    return;
  }
  const groupExists = (): boolean => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {}
  };
  signalGroup("SIGTERM");
  const deadline = Date.now() + 3000;
  while (groupExists() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (groupExists()) {
    signalGroup("SIGKILL");
    const killDeadline = Date.now() + 1000;
    while (groupExists() && Date.now() < killDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
