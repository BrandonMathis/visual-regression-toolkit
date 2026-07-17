import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { readConfig } from "../config/index.js";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { toolkitRevision } from "../platform/release.js";

export async function inspectConsumer(
  root: string,
  configPath: string,
): Promise<{ toolkitCommit: string; contractHash: string }> {
  return {
    toolkitCommit: toolkitRevision(),
    contractHash: (await readConfig(root, configPath)).hash,
  };
}

export async function scanArtifactTree(
  root: string,
  limits = { files: 50_100, bytes: 500 * 1024 * 1024 },
): Promise<{ files: number; bytes: number }> {
  const base = path.resolve(root);
  let files = 0,
    bytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = await lstat(absolute);
      if (entry.isSymbolicLink() || stat.isSymbolicLink())
        throw new VisualRegressionError(
          "INTERNAL_ERROR",
          "Artifact upload tree contains a symlink",
        );
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        files += 1;
        bytes += stat.size;
        if (files > limits.files || bytes > limits.bytes)
          throw new VisualRegressionError(
            "INTERNAL_ERROR",
            "Artifact upload tree exceeds limits",
          );
      } else
        throw new VisualRegressionError(
          "INTERNAL_ERROR",
          "Artifact upload tree contains a special file",
        );
    }
  }
  const stat = await lstat(base).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new VisualRegressionError(
      "INTERNAL_ERROR",
      "Artifact upload root is not a regular directory",
    );
  await walk(base);
  if (!files)
    throw new VisualRegressionError(
      "INTERNAL_ERROR",
      "Artifact upload tree is empty",
    );
  return { files, bytes };
}
