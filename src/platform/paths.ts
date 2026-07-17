import path from "node:path";
import { lstat, mkdir } from "node:fs/promises";
import { VisualRegressionError } from "../contracts/error-codes.js";

export function assertSafeRelativePath(value: string, label = "path"): string {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  )
    throw new VisualRegressionError("CONFIG_INVALID", `Unsafe ${label}`);
  const normalized = path.posix.normalize(value);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== value.replace(/^\.\//, "")
  )
    throw new VisualRegressionError("CONFIG_INVALID", `Unsafe ${label}`);
  return normalized;
}
export function resolveWithin(root: string, relative: string): string {
  const safe = assertSafeRelativePath(relative);
  const absolute = path.resolve(root, safe);
  if (
    absolute === root ||
    !absolute.startsWith(`${path.resolve(root)}${path.sep}`)
  )
    throw new VisualRegressionError("BASELINE_CORRUPT", "Path escapes root");
  return absolute;
}
export async function ensureSafeDirectory(
  root: string,
  relative: string,
): Promise<string> {
  const safe = assertSafeRelativePath(relative);
  let current = path.resolve(root);
  for (const component of safe.split("/")) {
    current = path.join(current, component);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat) await mkdir(current);
    else if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new VisualRegressionError(
        "CONFIG_INVALID",
        `Generated output contains an unsafe path: ${relative}`,
      );
  }
  return current;
}

export const toPosix = (value: string): string =>
  value.split(path.sep).join("/");
