import type { NormalizedConfig } from "../contracts/types.js";
import { hashVisualContract } from "./contract.js";
import { loadConfig } from "./load.js";
import { normalizeConfig } from "./normalize.js";
export async function readConfig(
  root: string,
  path?: string,
): Promise<{ config: NormalizedConfig; hash: string }> {
  const config = normalizeConfig(await loadConfig(root, path));
  return { config, hash: hashVisualContract(config) };
}
