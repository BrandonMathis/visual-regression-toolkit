/**
 * Fixed output layout (plan §10). All paths are relative to the consumer repo
 * root; the CLI clears generated directories before each operation.
 */
export const OUTPUT_ROOT = '.visual-regression';
export const CANDIDATE_DIR = '.visual-regression/candidate';
export const BASELINE_OUT_DIR = '.visual-regression/baseline';
export const RESULT_DIR = '.visual-regression/result';
export const RESULT_JSON_NAME = 'visual-result.json';
export const RESULT_SUMMARY_NAME = 'visual-summary.md';
export const PLAYWRIGHT_REPORT_DIR = 'playwright-report/visual';
export const TEST_RESULTS_DIR = 'test-results/visual';

/** File and directory names inside a baseline artifact. */
export const MANIFEST_NAME = 'baseline-manifest.json';
export const SCREENSHOTS_DIRNAME = 'screenshots';
