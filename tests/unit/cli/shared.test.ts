/**
 * Failure results must ALWAYS validate against visual-result.schema.json so
 * visual-result.json is written on every failure path (plan §10), no matter
 * how large the originating error is. This file deliberately uses the REAL
 * result module (no vi.mock) to prove schema validity end to end.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFailureResult, errorEntry } from '../../../src/cli/shared.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { RESULT_JSON_NAME } from '../../../src/paths.js';
import { validateResult, writeResult } from '../../../src/result/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vr-shared-'));
  tempDirs.push(dir);
  return dir;
}

function hugeError(): VisualRegressionError {
  const context: Record<string, string> = {};
  for (let i = 0; i < 30; i++) {
    context[`key${i}`] = 'v'.repeat(2000);
  }
  return new VisualRegressionError('INTERNAL_ERROR', 'x'.repeat(100_000), { context });
}

describe('errorEntry bounds', () => {
  it('truncates the message to the schema limit of 5000 characters', () => {
    const entry = errorEntry(hugeError());
    expect(entry.message.length).toBeLessThanOrEqual(5000);
    expect(entry.message.endsWith('…')).toBe(true);
    expect(entry.code).toBe('INTERNAL_ERROR');
  });

  it('caps context at 20 keys with values truncated to 500 characters', () => {
    const entry = errorEntry(hugeError());
    const context = entry.context ?? {};
    expect(Object.keys(context)).toHaveLength(20);
    for (const value of Object.values(context)) {
      expect(value.length).toBeLessThanOrEqual(500);
    }
  });

  it('leaves small messages and context untouched', () => {
    const entry = errorEntry(
      new VisualRegressionError('BUILD_FAILED', 'exit code 1', { context: { route: '/' } }),
    );
    expect(entry.message).toBe('exit code 1');
    expect(entry.context).toEqual({ route: '/' });
  });
});

describe('failure results with oversized errors', () => {
  it('a 100KB error message still produces a schema-valid, written visual-result.json', async () => {
    const result = buildFailureResult({
      operation: 'compare',
      error: hugeError(),
      host: false,
      candidateSha: null,
      visualContractHash: null,
      baseline: null,
    });

    // Schema-valid without throwing RESULT_INVALID...
    expect(() => validateResult(result)).not.toThrow();

    // ...and actually written to disk on the failure path.
    const resultDir = await makeTempDir();
    await writeResult(resultDir, result);
    const resultPath = path.join(resultDir, RESULT_JSON_NAME);
    expect(existsSync(resultPath)).toBe(true);

    const written = JSON.parse(await readFile(resultPath, 'utf8')) as {
      status: string;
      errors: { code: string; message: string }[];
    };
    expect(written.status).toBe('infrastructure-error');
    expect(written.errors[0]!.code).toBe('INTERNAL_ERROR');
    expect(written.errors[0]!.message.length).toBeLessThanOrEqual(5000);
  });
});
