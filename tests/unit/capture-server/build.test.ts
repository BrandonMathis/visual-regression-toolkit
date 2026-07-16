import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runBuild } from '../../../src/capture/server.js';
import { expectVisualError, makeConfig, pidAlive, waitFor } from './helpers.js';

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

  it('registers SIGINT/SIGTERM handlers while the build runs and removes them on exit', async () => {
    const sigintBefore = process.listenerCount('SIGINT');
    const sigtermBefore = process.listenerCount('SIGTERM');

    const config = makeConfig(tmpDir, {
      build: `node -e 'setTimeout(() => {}, 300)'`,
    });
    const building = runBuild(config, {});
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1);

    await building;
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
  });

  it('removes signal handlers when the build fails', async () => {
    const sigintBefore = process.listenerCount('SIGINT');
    const config = makeConfig(tmpDir, { build: 'node -e "process.exit(3)"' });
    await expectVisualError(runBuild(config, {}), 'BUILD_FAILED');
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
  });

  it('SIGINT during the build kills the detached build process group, including grandchildren', async () => {
    const pidFile = path.join(tmpDir, 'signal-grandchild-pid.txt');
    // Swallow the handler's re-raise so the test process survives; every
    // other pid (the process-group kill, pidAlive probes) passes through.
    const realKill = process.kill.bind(process);
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation((pid: number, signal?: string | number) => {
        if (pid === process.pid) return true;
        return realKill(pid, signal);
      });

    try {
      // The build leader spawns a long-lived grandchild in the same process
      // group and then sleeps forever; only a group kill reaps them both.
      const config = makeConfig(tmpDir, {
        build: `node -e 'const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "require(\\"node:fs\\").writeFileSync(process.env.PID_FILE, String(process.pid)); setInterval(() => {}, 1e9)"], { stdio: "ignore" }); setInterval(() => {}, 1e9)'`,
      });

      const failed = expectVisualError(runBuild(config, { PID_FILE: pidFile }), 'BUILD_FAILED');
      await waitFor(() => existsSync(pidFile), 'grandchild to write its pid file');
      const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);
      expect(pidAlive(pid)).toBe(true);

      process.emit('SIGINT', 'SIGINT');

      const error = await failed;
      expect(error.context.signal).toBe('SIGKILL');
      await waitFor(() => !pidAlive(pid), 'grandchild to be killed with the group');
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT');
    } finally {
      killSpy.mockRestore();
    }
  });
});
