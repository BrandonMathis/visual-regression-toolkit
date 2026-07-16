import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBaseline, verifyBaseline } from '../../../src/baseline/index.js';
import { MANIFEST_NAME } from '../../../src/paths.js';
import type { BaselineManifest } from '../../../src/types.js';
import {
  cleanupFixtures,
  editManifest,
  expectVisualError,
  makeBaselineFixture,
} from './helpers.js';

afterEach(cleanupFixtures);

async function makeVerifiedBaseline(): Promise<{
  baselineDir: string;
  manifest: BaselineManifest;
}> {
  const { baselineDir, options } = await makeBaselineFixture();
  const manifest = await createBaseline(options);
  return { baselineDir, manifest };
}

function firstScreenshot(manifest: BaselineManifest) {
  const entry = manifest.screenshots[0];
  if (entry === undefined) {
    throw new Error('fixture manifest has no screenshots');
  }
  return entry;
}

describe('verifyBaseline manifest handling', () => {
  it('rejects a missing manifest with BASELINE_CORRUPT', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await rm(join(baselineDir, MANIFEST_NAME));

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('not found');
  });

  it('rejects truncated manifest JSON with BASELINE_CORRUPT', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    const manifestPath = join(baselineDir, MANIFEST_NAME);
    const raw = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, raw.slice(0, Math.floor(raw.length / 2)));

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('not valid JSON');
  });

  it('rejects an unknown top-level field with BASELINE_CORRUPT and error paths', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      (manifest as unknown as Record<string, unknown>).unexpectedField = true;
    });

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('schema validation');
    expect(error.context.errorPaths).toBeDefined();
  });

  it('rejects a sha256 with the wrong length with BASELINE_CORRUPT', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      firstScreenshot(manifest).sha256 = 'a'.repeat(63);
    });

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('schema validation');
    expect(error.context.errorPaths).toContain('sha256');
  });

  it('rejects an unsupported schemaVersion with BASELINE_CORRUPT', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      (manifest as { schemaVersion: number }).schemaVersion = 2;
    });

    await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
  });

  it('rejects a non-full-length sourceSha with BASELINE_CORRUPT', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      manifest.sourceSha = 'abc123';
    });

    await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
  });

  it('rejects duplicate screenshot entries with BASELINE_CORRUPT', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      manifest.screenshots.push({ ...firstScreenshot(manifest) });
    });

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('Duplicate');
  });
});

describe('verifyBaseline screenshot content checks', () => {
  it('rejects when a listed screenshot file was deleted', async () => {
    const { baselineDir, manifest } = await makeVerifiedBaseline();
    const entry = firstScreenshot(manifest);
    await rm(join(baselineDir, entry.path));

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('missing');
    expect(error.context.path).toBe(entry.path);
  });

  it('rejects when a screenshot byte was altered (checksum mismatch)', async () => {
    const { baselineDir, manifest } = await makeVerifiedBaseline();
    const entry = firstScreenshot(manifest);
    const filePath = join(baselineDir, entry.path);
    const data = await readFile(filePath);
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    await writeFile(filePath, data);

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('checksum');
    expect(error.context.path).toBe(entry.path);
  });

  it('rejects when a screenshot byte size changed', async () => {
    const { baselineDir, manifest } = await makeVerifiedBaseline();
    const entry = firstScreenshot(manifest);
    const filePath = join(baselineDir, entry.path);
    const data = await readFile(filePath);
    await writeFile(filePath, Buffer.concat([data, Buffer.from([0])]));

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('byte size');
  });

  it('rejects same-size non-PNG content even when the checksum matches', async () => {
    const { baselineDir, manifest } = await makeVerifiedBaseline();
    const entry = firstScreenshot(manifest);
    const filePath = join(baselineDir, entry.path);
    const garbage = Buffer.alloc(entry.bytes, 0x41);
    await writeFile(filePath, garbage);
    await editManifest(baselineDir, (edited) => {
      firstScreenshot(edited).sha256 = createHash('sha256').update(garbage).digest('hex');
    });

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('PNG');
  });

  it('rejects a manifest dimension mismatch', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      firstScreenshot(manifest).width += 1;
    });

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('dimension');
  });

  it('rejects a manifest bytes mismatch', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      firstScreenshot(manifest).bytes += 1;
    });

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('byte size');
  });
});

describe('verifyBaseline extra files and path safety', () => {
  it('rejects an extra file inside a screenshots directory', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await writeFile(join(baselineDir, 'screenshots', 'desktop', 'rogue.png'), Buffer.from('x'));

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('Unexpected file');
    expect(error.context.path).toContain('rogue.png');
  });

  it('rejects an extra file at the baseline root', async () => {
    const { baselineDir } = await makeVerifiedBaseline();
    await writeFile(join(baselineDir, 'notes.txt'), 'stray');

    const error = await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
    expect(error.message).toContain('Unexpected file');
  });

  it.each([
    ['traversal', '../escape.png'],
    ['absolute', '/etc/escape.png'],
    ['backslash', 'screenshots\\desktop\\home.png'],
  ])('rejects a %s screenshot path', async (_label, badPath) => {
    const { baselineDir } = await makeVerifiedBaseline();
    await editManifest(baselineDir, (manifest) => {
      firstScreenshot(manifest).path = badPath;
    });

    await expectVisualError(verifyBaseline(baselineDir), 'BASELINE_CORRUPT');
  });
});
