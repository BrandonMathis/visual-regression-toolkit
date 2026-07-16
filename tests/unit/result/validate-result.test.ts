import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isVisualRegressionError } from '../../../src/errors.js';
import { RESULT_JSON_NAME, RESULT_SUMMARY_NAME } from '../../../src/paths.js';
import { renderMarkdownSummary } from '../../../src/reporters/index.js';
import { validateResult, writeResult } from '../../../src/result/index.js';
import { makeEntry, makeResult, makeTempDir } from './helpers.js';
import type { VisualResult, VisualResultError } from '../../../src/types.js';

function expectResultInvalid(value: unknown): void {
  let thrown: unknown;
  try {
    validateResult(value);
  } catch (error) {
    thrown = error;
  }
  expect(
    isVisualRegressionError(thrown) && thrown.code === 'RESULT_INVALID',
    `expected RESULT_INVALID, got ${String(thrown)}`,
  ).toBe(true);
}

describe('validateResult', () => {
  it('round-trips a full valid VisualResult', () => {
    const result = makeResult({
      operation: 'compare',
      status: 'visual-diff',
      totals: { routes: 2, screenshots: 4, changed: 1, added: 1, removed: 1 },
      comparisons: [
        makeEntry({
          status: 'changed',
          diffPath: '.visual-regression/result/diffs/desktop/home.png',
          diffPixelRatio: 0.25,
        }),
        makeEntry({
          route: '/new',
          screenshotName: 'new.png',
          status: 'added',
          expectedPath: null,
          diffPixelRatio: null,
        }),
        makeEntry({
          route: '/old',
          screenshotName: 'old.png',
          status: 'removed',
          actualPath: null,
          diffPixelRatio: null,
        }),
      ],
      errors: [],
      reports: {
        html: 'playwright-report/visual/index.html',
        json: '.visual-regression/result/visual-result.json',
        markdown: '.visual-regression/result/visual-summary.md',
      },
    });
    expect(validateResult(result)).toEqual(result);
  });

  it('accepts null candidateSha, baseline, and visualContractHash', () => {
    const result = makeResult({
      status: 'infrastructure-error',
      candidateSha: null,
      baseline: null,
      visualContractHash: null,
      errors: [{ code: 'BASELINE_NOT_FOUND', message: 'no baseline', retryable: true }],
    });
    expect(validateResult(result)).toEqual(result);
  });

  it('accepts error entries with a string context', () => {
    const result = makeResult({
      status: 'infrastructure-error',
      errors: [
        {
          code: 'CAPTURE_FAILED',
          message: 'capture failed',
          retryable: false,
          context: { route: '/', project: 'desktop' },
        },
      ],
    });
    expect(validateResult(result)).toEqual(result);
  });

  it('rejects unknown top-level fields', () => {
    expectResultInvalid({ ...makeResult(), unexpected: true });
  });

  it('rejects unknown nested fields', () => {
    expectResultInvalid(
      makeResult({
        totals: { routes: 1, screenshots: 1, changed: 0, added: 0, removed: 0, extra: 1 } as never,
      }),
    );
  });

  it('rejects an unknown status enum value', () => {
    expectResultInvalid(makeResult({ status: 'ok' as never }));
  });

  it('rejects an unknown operation enum value', () => {
    expectResultInvalid(makeResult({ operation: 'diff' as never }));
  });

  it('rejects a wrong schemaVersion', () => {
    expectResultInvalid(makeResult({ schemaVersion: 2 }));
  });

  it('rejects negative totals', () => {
    expectResultInvalid(
      makeResult({ totals: { routes: -1, screenshots: 0, changed: 0, added: 0, removed: 0 } }),
    );
  });

  it('rejects non-integer totals', () => {
    expectResultInvalid(
      makeResult({ totals: { routes: 1.5, screenshots: 0, changed: 0, added: 0, removed: 0 } }),
    );
  });

  it('rejects more than 10000 comparison entries', () => {
    const comparisons = Array.from({ length: 10_001 }, () => makeEntry());
    expectResultInvalid(makeResult({ comparisons }));
  });

  it('rejects more than 100 errors', () => {
    const errors: VisualResultError[] = Array.from({ length: 101 }, () => ({
      code: 'INTERNAL_ERROR',
      message: 'boom',
      retryable: false,
    }));
    expectResultInvalid(makeResult({ status: 'infrastructure-error', errors }));
  });

  it('rejects an error message over 5000 characters', () => {
    expectResultInvalid(
      makeResult({
        status: 'infrastructure-error',
        errors: [{ code: 'INTERNAL_ERROR', message: 'x'.repeat(5001), retryable: false }],
      }),
    );
  });

  it('rejects a route over 1000 characters', () => {
    expectResultInvalid(
      makeResult({ comparisons: [makeEntry({ route: `/${'x'.repeat(1000)}` })] }),
    );
  });

  it('rejects a diffPixelRatio above 1', () => {
    expectResultInvalid(makeResult({ comparisons: [makeEntry({ diffPixelRatio: 1.5 })] }));
  });

  it('rejects visual-diff for a baseline-create operation', () => {
    expectResultInvalid(
      makeResult({
        operation: 'baseline-create',
        status: 'visual-diff',
        totals: { routes: 1, screenshots: 1, changed: 1, added: 0, removed: 0 },
      }),
    );
  });

  it('rejects visual-diff with zero changed, added, and removed', () => {
    expectResultInvalid(
      makeResult({
        status: 'visual-diff',
        totals: { routes: 1, screenshots: 1, changed: 0, added: 0, removed: 0 },
      }),
    );
  });

  it('rejects pass with recorded errors', () => {
    expectResultInvalid(
      makeResult({
        status: 'pass',
        errors: [{ code: 'INTERNAL_ERROR', message: 'boom', retryable: false }],
      }),
    );
  });

  it('lists a bounded number of schema errors in the message', () => {
    let thrown: unknown;
    try {
      validateResult({ schemaVersion: 2 });
    } catch (error) {
      thrown = error;
    }
    expect(isVisualRegressionError(thrown)).toBe(true);
    if (isVisualRegressionError(thrown)) {
      expect(thrown.message.length).toBeLessThan(2000);
      expect(thrown.context['errorCount']).toBeDefined();
    }
  });
});

describe('writeResult', () => {
  let resultDir: string;

  beforeEach(async () => {
    resultDir = path.join(await makeTempDir(), 'result');
  });

  afterEach(async () => {
    await rm(path.dirname(resultDir), { recursive: true, force: true });
  });

  it('writes visual-result.json and visual-summary.md', async () => {
    const result = makeResult();
    await writeResult(resultDir, result);

    const json = await readFile(path.join(resultDir, RESULT_JSON_NAME), 'utf8');
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('\n  "operation": "compare",');
    expect(JSON.parse(json) as VisualResult).toEqual(result);

    const markdown = await readFile(path.join(resultDir, RESULT_SUMMARY_NAME), 'utf8');
    expect(markdown).toBe(renderMarkdownSummary(result));
  });

  it('rejects an invalid result without writing files', async () => {
    const result = makeResult({ status: 'nope' as never });
    await expect(writeResult(resultDir, result)).rejects.toSatisfy(
      (error: unknown) => isVisualRegressionError(error) && error.code === 'RESULT_INVALID',
    );
    await expect(readFile(path.join(resultDir, RESULT_JSON_NAME), 'utf8')).rejects.toThrow();
  });
});
