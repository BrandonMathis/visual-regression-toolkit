import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { VisualRegressionError, isVisualRegressionError } from '../errors.js';
import {
  BASELINE_OUT_DIR,
  CANDIDATE_DIR,
  PLAYWRIGHT_REPORT_DIR,
  RESULT_DIR,
  RESULT_JSON_NAME,
  RESULT_SUMMARY_NAME,
  TEST_RESULTS_DIR,
} from '../paths.js';
import { writeResult } from '../result/index.js';
import {
  CHROMIUM_REVISION,
  PLAYWRIGHT_VERSION,
  VISUAL_RESULT_SCHEMA_VERSION,
  hostEnvironment,
  toolkitVersion,
} from '../runtime.js';
import type { VisualOperation, VisualResult, VisualResultError } from '../types.js';
import type { Logger } from './logger.js';

export const HOST_WARNING =
  'Host execution is diagnostic only: host screenshots are NOT authoritative and NOT comparable to CI baselines.';

/** Directories cleared and rewritten by baseline create / compare (plan §10). */
export const CLEARED_OUTPUT_DIRS: readonly string[] = [
  CANDIDATE_DIR,
  BASELINE_OUT_DIR,
  RESULT_DIR,
  PLAYWRIGHT_REPORT_DIR,
  TEST_RESULTS_DIR,
];

export async function clearOutputDirs(repoRoot: string): Promise<void> {
  for (const dir of CLEARED_OUTPUT_DIRS) {
    const abs = path.resolve(repoRoot, dir);
    await rm(abs, { recursive: true, force: true });
    await mkdir(abs, { recursive: true });
  }
}

/** A --baseline dir inside a cleared output dir would be destroyed before use. */
export function assertBaselineDirOutsideOutputs(repoRoot: string, baselineDir: string): void {
  const abs = path.resolve(repoRoot, baselineDir);
  for (const dir of CLEARED_OUTPUT_DIRS) {
    const rel = path.relative(path.resolve(repoRoot, dir), abs);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new VisualRegressionError(
        'CONFIG_INVALID',
        `--baseline must not point inside the generated output directory '${dir}' because it is cleared before capture`,
        { context: { path: baselineDir } },
      );
    }
  }
}

export function toVisualError(error: unknown): VisualRegressionError {
  if (isVisualRegressionError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new VisualRegressionError('INTERNAL_ERROR', message, { cause: error });
}

export function errorEntry(error: VisualRegressionError): VisualResultError {
  const entry: VisualResultError = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
  if (Object.keys(error.context).length > 0) {
    entry.context = error.context;
  }
  return entry;
}

export function runtimeBlock(host: boolean): VisualResult['runtime'] {
  const { os, arch } = hostEnvironment();
  return {
    toolkitVersion: toolkitVersion(),
    playwrightVersion: PLAYWRIGHT_VERSION,
    chromiumRevision: CHROMIUM_REVISION,
    os,
    arch,
    host,
  };
}

export function resultReports(options: { htmlReady: boolean }): VisualResult['reports'] {
  return {
    html: options.htmlReady ? `${PLAYWRIGHT_REPORT_DIR}/index.html` : null,
    json: `${RESULT_DIR}/${RESULT_JSON_NAME}`,
    markdown: `${RESULT_DIR}/${RESULT_SUMMARY_NAME}`,
  };
}

export interface FailureResultInputs {
  operation: VisualOperation;
  error: VisualRegressionError;
  host: boolean;
  candidateSha: string | null;
  visualContractHash: string | null;
  baseline: VisualResult['baseline'];
  totals?: Partial<VisualResult['totals']>;
}

export function buildFailureResult(inputs: FailureResultInputs): VisualResult {
  return {
    schemaVersion: VISUAL_RESULT_SCHEMA_VERSION,
    operation: inputs.operation,
    status: 'infrastructure-error',
    createdAt: new Date().toISOString(),
    candidateSha: inputs.candidateSha,
    baseline: inputs.baseline,
    visualContractHash: inputs.visualContractHash,
    runtime: runtimeBlock(inputs.host),
    totals: { routes: 0, screenshots: 0, changed: 0, added: 0, removed: 0, ...inputs.totals },
    comparisons: [],
    errors: [errorEntry(inputs.error)],
    reports: resultReports({ htmlReady: false }),
  };
}

export async function writeResultBestEffort(
  repoRoot: string,
  result: VisualResult,
  logger: Logger,
): Promise<void> {
  try {
    await writeResult(path.resolve(repoRoot, RESULT_DIR), result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to write ${RESULT_JSON_NAME}: ${message}`);
  }
}

/** Machine output: the ONLY stdout writer in --json mode. */
export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
