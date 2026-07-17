import type { NormalizedConfig } from "../contracts/types.js";
import { runCommand } from "../process/command.js";
import { startServer } from "../process/server.js";
export async function buildAndStart(
  root: string,
  config: NormalizedConfig,
  logicalDate: string,
) {
  const env = {
    ...process.env,
    [config.clock.environmentVariable]: logicalDate,
  };
  await runCommand(config.commands.build, root, env);
  const readiness = new URL(
    config.server.readinessPath,
    config.server.origin,
  ).toString();
  return startServer(
    config.commands.start,
    root,
    env,
    readiness,
    config.server.startupTimeoutMs,
  );
}
