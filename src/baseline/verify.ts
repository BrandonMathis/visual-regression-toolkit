import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { validateManifestShape } from "../contracts/validate.js";
import type { BaselineManifest, ReleaseIdentity } from "../contracts/types.js";
import { inspectPng } from "./checksum.js";
import {
  makeVerifiedBaseline,
  pairKey,
  type VerifiedBaseline,
} from "./verified-baseline.js";
import { resolveWithin } from "../platform/paths.js";
import { normalizeRoute, routeFileName } from "../discovery/route-name.js";
import { parseJsonWithoutDuplicateKeys } from "../platform/strict-json.js";

export type Compatibility = {
  consumerRepository: string;
  sourceSha: string;
  visualContractHash: string;
  release: ReleaseIdentity;
};
async function filesBelow(root: string, relative = ""): Promise<string[]> {
  const directory = relative ? resolveWithin(root, relative) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink())
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        `Symlink forbidden: ${next}`,
      );
    if (entry.isDirectory()) files.push(...(await filesBelow(root, next)));
    else if (entry.isFile()) files.push(next);
    else
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        `Special file forbidden: ${next}`,
      );
  }
  return files;
}
function compatible(manifest: BaselineManifest, expected: Compatibility): void {
  if (manifest.visualContractHash !== expected.visualContractHash)
    throw new VisualRegressionError(
      "VISUAL_CONTRACT_CHANGED",
      "Baseline visual contract does not match candidate",
    );
  const actual = manifest.release;
  const wanted = expected.release;
  if (
    manifest.consumerRepository.toLowerCase() !==
      expected.consumerRepository.toLowerCase() ||
    manifest.sourceSha !== expected.sourceSha ||
    actual.toolkitCommit !== wanted.toolkitCommit ||
    actual.playwrightVersion !== wanted.playwrightVersion ||
    actual.chromiumRevision !== wanted.chromiumRevision ||
    actual.containerDigest !== wanted.containerDigest ||
    actual.os !== wanted.os ||
    actual.architecture !== wanted.architecture ||
    actual.platform !== wanted.platform ||
    actual.authoritative !== wanted.authoritative
  )
    throw new VisualRegressionError(
      "BASELINE_INCOMPATIBLE",
      "Baseline compatibility identity does not match",
    );
}
export async function verifyBaseline(
  root: string,
  expected?: Compatibility,
): Promise<VerifiedBaseline> {
  const rootStat = await lstat(root).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Baseline root must be a regular directory",
    );
  const canonicalRoot = await realpath(root);
  const manifestPath = path.join(canonicalRoot, "baseline-manifest.json");
  const stat = await lstat(manifestPath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 5_000_000)
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Manifest must be a bounded regular file",
    );
  let manifest: unknown;
  try {
    manifest = parseJsonWithoutDuplicateKeys(
      await readFile(manifestPath, "utf8"),
    );
  } catch {
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Manifest is not valid JSON",
    );
  }
  validateManifestShape(manifest);
  for (const descriptor of manifest.routes) {
    let normalized: string;
    try {
      normalized = normalizeRoute(descriptor.route);
    } catch {
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        `Invalid route in baseline: ${descriptor.route}`,
      );
    }
    if (
      normalized !== descriptor.route ||
      routeFileName(normalized) !== descriptor.fileName
    )
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        `Invalid route filename: ${descriptor.route}`,
      );
  }
  const routeMap = new Map(
    manifest.routes.map((route) => [route.route, route.fileName]),
  );
  if (
    routeMap.size !== manifest.routes.length ||
    new Set(manifest.projects.map((project) => project.name.toLowerCase()))
      .size !== manifest.projects.length
  )
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Duplicate routes or projects",
    );
  const expectedCount = manifest.routes.length * manifest.projects.length;
  if (manifest.screenshots.length !== expectedCount)
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Screenshot set is incomplete",
    );
  const index = new Map<string, BaselineManifest["screenshots"][number]>();
  const pathSet = new Set<string>();
  const folded = new Set<string>();
  for (const screenshot of manifest.screenshots) {
    const key = pairKey(screenshot.route, screenshot.project);
    const expectedName = routeMap.get(screenshot.route);
    if (
      !expectedName ||
      !manifest.projects.some(
        (project) => project.name === screenshot.project,
      ) ||
      screenshot.path !==
        path.posix.join("screenshots", screenshot.project, expectedName) ||
      index.has(key)
    )
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        "Invalid or duplicate screenshot entry",
      );
    const lower = screenshot.path.normalize("NFC").toLowerCase();
    if (folded.has(lower))
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        "Case-folded path collision",
      );
    folded.add(lower);
    pathSet.add(screenshot.path);
    const absolute = resolveWithin(canonicalRoot, screenshot.path);
    const imageStat = await lstat(absolute).catch(() => undefined);
    if (!imageStat?.isFile() || imageStat.isSymbolicLink())
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        `Missing or unsafe screenshot: ${screenshot.path}`,
      );
    const actual = await inspectPng(absolute);
    if (
      actual.width !== screenshot.width ||
      actual.height !== screenshot.height ||
      actual.byteSize !== screenshot.byteSize ||
      actual.sha256 !== screenshot.sha256
    )
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        `Screenshot metadata mismatch: ${screenshot.path}`,
      );
    index.set(key, screenshot);
  }
  const actualFiles = (await filesBelow(canonicalRoot))
    .filter((file) => file !== "baseline-manifest.json")
    .sort();
  if (
    actualFiles.length !== pathSet.size ||
    actualFiles.some((file) => !pathSet.has(file))
  )
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Baseline contains missing or extra files",
    );
  if (expected) compatible(manifest, expected);
  return makeVerifiedBaseline(manifest, index, canonicalRoot);
}
