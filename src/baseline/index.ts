/**
 * Baseline manifest creation, verification, and compatibility (plan §8).
 *
 * IMPLEMENTATION CONTRACT (agent: replace bodies, keep signatures):
 * - createBaseline: assemble baselineDir (baseline-manifest.json +
 *   screenshots/<project>/<name>) from captured screenshots; record every
 *   §8.1 field incl. per-file dimensions, byte size, sha256. Write the
 *   manifest only after every expected screenshot exists. Then verify in-place.
 * - verifyBaseline: validate manifest JSON against
 *   schemas/baseline-manifest.schema.json (ajv), check every screenshot
 *   exists with matching size/dimensions/checksum, and that no extra files
 *   exist. Failures -> BASELINE_CORRUPT.
 * - checkBaselineCompatibility: compare manifest against a
 *   CompatibilityIdentity. Same everything but different visualContractHash
 *   -> VISUAL_CONTRACT_CHANGED; any other mismatch -> BASELINE_INCOMPATIBLE.
 */
import type { BaselineManifest, CompatibilityIdentity, ResolvedProject, RouteDescriptor } from '../types.js';

export interface CreateBaselineOptions {
  /** Captured screenshots at <screenshotsDir>/<project>/<screenshotName>. */
  screenshotsDir: string;
  /** Output directory to assemble the baseline artifact content into. */
  baselineDir: string;
  routes: RouteDescriptor[];
  projects: ResolvedProject[];
  identity: {
    repository: string;
    baseBranch: string;
    sourceSha: string;
    workflowRunId: string;
    workflowRunAttempt: number;
    createdAt: string;
    logicalDate: string;
  };
  environment: { os: string; arch: string; containerDigest: string; platform: string };
  visualContractHash: string;
}

export async function createBaseline(options: CreateBaselineOptions): Promise<BaselineManifest> {
  void options;
  throw new Error('not implemented');
}

export async function verifyBaseline(baselineDir: string): Promise<BaselineManifest> {
  void baselineDir;
  throw new Error('not implemented');
}

export function checkBaselineCompatibility(
  manifest: BaselineManifest,
  expected: CompatibilityIdentity,
): void {
  void manifest;
  void expected;
  throw new Error('not implemented');
}
