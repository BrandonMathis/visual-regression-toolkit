import path from "node:path";
import { lstat } from "node:fs/promises";
import { createJiti } from "jiti";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { assertSafeRelativePath } from "../platform/paths.js";

export async function loadConfig(
  root: string,
  configPath = "visual-regression.config.ts",
): Promise<unknown> {
  assertSafeRelativePath(configPath, "config path");
  const absolute = path.resolve(root, configPath);
  const stat = await lstat(absolute).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Configuration must be a regular non-symlink file",
    );
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    moduleCache: false,
  });
  const loaded = await jiti.import(absolute, { default: true });
  if (
    loaded === null ||
    typeof loaded !== "object" ||
    Array.isArray(loaded) ||
    Object.getPrototypeOf(loaded) !== Object.prototype
  )
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Configuration default export must be a plain object",
    );
  return loaded;
}
