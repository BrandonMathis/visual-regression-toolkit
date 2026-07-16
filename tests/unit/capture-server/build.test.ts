import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runBuild } from '../../../src/capture/server.js';
import { expectVisualError, makeConfig } from './helpers.js';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vr-build-test-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runBuild', () => {
  it('resolves when the build command exits 0', async () => {
    const config = makeConfig(tmpDir, { build: 'node -e "process.exit(0)"' });
    await expect(runBuild(config, {})).resolves.toBeUndefined();
  });

  it('merges the provided env over the process env', async () => {
    const outFile = path.join(tmpDir, 'env-out.txt');
    const config = makeConfig(tmpDir, {
      build: `node -e 'require("node:fs").writeFileSync(process.env.OUT_FILE, process.env.MARKER)'`,
    });
    await runBuild(config, { OUT_FILE: outFile, MARKER: 'from-env' });
    expect(readFileSync(outFile, 'utf8')).toBe('from-env');
  });

  it('runs the command with cwd set to repoRoot', async () => {
    const outFile = path.join(tmpDir, 'cwd-out.txt');
    const config = makeConfig(tmpDir, {
      build: `node -e 'require("node:fs").writeFileSync(process.env.OUT_FILE, process.cwd())'`,
    });
    await runBuild(config, { OUT_FILE: outFile });
    // macOS tmpdir may be reached through the /private symlink.
    expect([tmpDir, path.join('/private', tmpDir)]).toContain(readFileSync(outFile, 'utf8'));
  });

  it('throws BUILD_FAILED with the exit code when the build fails', async () => {
    const config = makeConfig(tmpDir, { build: 'node -e "process.exit(7)"' });
    const error = await expectVisualError(runBuild(config, {}), 'BUILD_FAILED');
    expect(error.context.exitCode).toBe('7');
    expect(error.context.command).toBe('node -e "process.exit(7)"');
  });

  it('throws BUILD_FAILED with the signal when the build is killed', async () => {
    const config = makeConfig(tmpDir, { build: 'kill -TERM $$' });
    const error = await expectVisualError(runBuild(config, {}), 'BUILD_FAILED');
    expect(error.context.signal).toBe('SIGTERM');
    expect(error.context.exitCode).toBeUndefined();
  });
});
