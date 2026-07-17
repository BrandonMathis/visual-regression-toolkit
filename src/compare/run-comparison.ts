import path from "node:path";
import type { CaptureRecord, Difference } from "../contracts/types.js";
import type { VerifiedBaseline } from "../baseline/verified-baseline.js";
import { pairKey } from "../baseline/verified-baseline.js";
import { pixelDiff } from "./pixel-diff.js";
export async function compareCaptures(
  baseline: VerifiedBaseline,
  candidate: CaptureRecord[],
  resultRoot: string,
  threshold: number,
): Promise<{
  changed: Difference[];
  added: Difference[];
  removed: Difference[];
}> {
  const candidateIndex = new Map(
    candidate.map((item) => [pairKey(item.route, item.project), item]),
  );
  if (candidateIndex.size !== candidate.length)
    throw new Error("Candidate contains duplicate route/project pairs");
  const changed: Difference[] = [];
  const added: Difference[] = [];
  const removed: Difference[] = [];
  for (const [key, actual] of candidateIndex) {
    const expected = baseline.index.get(key);
    if (!expected) {
      added.push({
        route: actual.route,
        project: actual.project,
        actualPath: path.posix.join(
          ".visual-regression/candidate",
          actual.path,
        ),
      });
      continue;
    }
    const diffPath = path.posix.join(
      "diffs",
      actual.project,
      path.basename(actual.path),
    );
    const comparison = await pixelDiff(
      path.join(baseline.root, expected.path),
      actual.absolutePath,
      path.join(resultRoot, diffPath),
      threshold,
    );
    if (comparison.differingPixels > 0)
      changed.push({
        route: actual.route,
        project: actual.project,
        expectedPath: path.posix.join(
          ".visual-regression/baseline",
          expected.path,
        ),
        actualPath: path.posix.join(
          ".visual-regression/candidate",
          actual.path,
        ),
        diffPath: path.posix.join(".visual-regression/result", diffPath),
        ...comparison,
      });
  }
  for (const [key, expected] of baseline.index)
    if (!candidateIndex.has(key))
      removed.push({
        route: expected.route,
        project: expected.project,
        expectedPath: path.posix.join(
          ".visual-regression/baseline",
          expected.path,
        ),
      });
  const sort = (a: Difference, b: Difference) =>
    `${a.project}\0${a.route}`.localeCompare(`${b.project}\0${b.route}`);
  return {
    changed: changed.sort(sort),
    added: added.sort(sort),
    removed: removed.sort(sort),
  };
}
