/**
 * Comparison and the visual-result contract (plan §10).
 *
 * IMPLEMENTATION CONTRACT (agent: replace bodies, keep signatures):
 * - compareAgainstBaseline: pixelmatch every baseline-manifest route/project
 *   pair against candidate screenshots using
 *   config.capture.screenshot.threshold; any differing pixel -> 'changed'
 *   with a diff PNG in diffDir. Candidate-only pairs -> 'added';
 *   baseline-only -> 'removed'. Dimension mismatch -> 'changed'
 *   (diffPixelRatio 1, diff canvas sized to max dims). Unreadable candidate
 *   PNG -> CAPTURE_FAILED infrastructure error.
 * - validateResult: ajv against schemas/visual-result.schema.json with size
 *   bounds; failures -> RESULT_INVALID.
 * - writeResult: validate, write RESULT_JSON_NAME plus RESULT_SUMMARY_NAME
 *   (via reporters/renderMarkdownSummary) into resultDir.
 */
import type {
  BaselineManifest,
  ComparisonEntry,
  ResolvedVisualConfig,
  VisualResult,
} from '../types.js';

export interface CompareInputs {
  config: ResolvedVisualConfig;
  baselineDir: string;
  baselineManifest: BaselineManifest;
  /** Candidate screenshots at <candidateScreenshotsDir>/<project>/<name>. */
  candidateScreenshotsDir: string;
  /** Diff PNGs are written to <diffDir>/<project>/<name>. */
  diffDir: string;
}

export interface ComparisonOutcome {
  entries: ComparisonEntry[];
  changed: number;
  added: number;
  removed: number;
}

export async function compareAgainstBaseline(inputs: CompareInputs): Promise<ComparisonOutcome> {
  void inputs;
  throw new Error('not implemented');
}

export function validateResult(value: unknown): VisualResult {
  void value;
  throw new Error('not implemented');
}

export async function writeResult(resultDir: string, result: VisualResult): Promise<void> {
  void resultDir;
  void result;
  throw new Error('not implemented');
}
