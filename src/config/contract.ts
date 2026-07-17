import { createHash } from "node:crypto";
import type { NormalizedConfig } from "../contracts/types.js";
import { canonicalJson } from "../platform/canonical-json.js";

export function projectVisualContract(config: NormalizedConfig): unknown {
  return {
    adapterVersion: 1,
    stabilizationVersion: 1,
    namingVersion: 1,
    framework: config.framework,
    commands: config.commands,
    server: config.server,
    routeSelection: config.routes,
    clock: config.clock,
    projects: config.projects,
    capture: config.capture,
  };
}
export function hashVisualContract(config: NormalizedConfig): string {
  return createHash("sha256")
    .update("thisdot-visual-contract-v1\0")
    .update(canonicalJson(projectVisualContract(config)))
    .digest("hex");
}
