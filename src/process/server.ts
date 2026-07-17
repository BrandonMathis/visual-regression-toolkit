import type { ChildProcess } from "node:child_process";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { spawnCommand, stopProcess } from "./command.js";

export async function startServer(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  url: string,
  timeoutMs: number,
): Promise<{ child: ChildProcess; stop: () => Promise<void> }> {
  try {
    const existing = await fetch(url, {
      signal: AbortSignal.timeout(500),
      redirect: "manual",
    });
    await existing.body?.cancel();
    throw new VisualRegressionError(
      "SERVER_FAILED",
      `Readiness URL is already responding before server start: ${url}`,
    );
  } catch (error) {
    if (error instanceof VisualRegressionError) throw error;
  }
  const child = spawnCommand(command, cwd, env, true);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new VisualRegressionError(
        "SERVER_FAILED",
        `Server exited with code ${String(child.exitCode)}`,
      );
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        redirect: "manual",
      });
      const ready = response.status >= 200 && response.status < 400;
      await response.body?.cancel();
      if (ready) return { child, stop: () => stopProcess(child) };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopProcess(child);
  throw new VisualRegressionError(
    "SERVER_TIMEOUT",
    `Server was not ready within ${timeoutMs}ms`,
    true,
  );
}
