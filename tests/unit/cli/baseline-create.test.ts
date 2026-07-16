import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/config/index.js', () => ({
  defineVisualConfig: (config: unknown) => config,
  loadConfig: vi.fn(),
  resolveConfig: vi.fn(),
  computeVisualContractHash: vi.fn(),
}));
vi.mock('../../../src/discovery/index.js', () => ({
  discoverRoutes: vi.fn(),
  screenshotNameForRoute: vi.fn(),
  assignScreenshotNames: vi.fn(),
}));
vi.mock('../../../src/capture/index.js', () => ({
  runBuild: vi.fn(),
  startServer: vi.fn(),
  captureRoutes: vi.fn(),
}));
vi.mock('../../../src/baseline/index.js', () => ({
  createBaseline: vi.fn(),
  verifyBaseline: vi.fn(),
  checkBaselineCompatibility: vi.fn(),
}));
vi.mock('../../../src/result/index.js', () => ({
  compareAgainstBaseline: vi.fn(),
  validateResult: vi.fn(),
  writeResult: vi.fn(),
}));
vi.mock('../../../src/reporters/index.js', () => ({
  renderMarkdownSummary: vi.fn(() => ''),
}));

import { createBaseline, verifyBaseline } from '../../../src/baseline/index.js';
import { captureRoutes, runBuild, startServer } from '../../../src/capture/index.js';
import { runCli } from '../../../src/cli/index.js';
import { computeVisualContractHash, loadConfig } from '../../../src/config/index.js';
import { discoverRoutes } from '../../../src/discovery/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { writeResult } from '../../../src/result/index.js';
import { CONTAINER_DIGEST, CONTAINER_PLATFORM } from '../../../src/runtime.js';
import {
  CONTRACT_HASH,
  FULL_SHA,
  captureStdio,
  makeConfig,
  makeManifest,
  makeRepoRoot,
  stubGitHubEnv,
  type CapturedStdio,
} from './fixtures.js';

function callOrder(fn: unknown): number {
  return (fn as Mock).mock.invocationCallOrder[0]!;
}

describe('baseline create', () => {
  let repoRoot: string;
  let stdio: CapturedStdio;
  let stopFn: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await makeRepoRoot();
    stubGitHubEnv();
    // An empty clock env var counts as unset: a fresh timestamp is minted.
    vi.stubEnv('VISUAL_TEST_DATE', '');
    stdio = captureStdio();
    const config = makeConfig(repoRoot);
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(computeVisualContractHash).mockReturnValue(CONTRACT_HASH);
    vi.mocked(runBuild).mockResolvedValue(undefined);
    vi.mocked(discoverRoutes).mockResolvedValue([{ route: '/', screenshotName: 'home.png' }]);
    stopFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(startServer).mockResolvedValue({ origin: config.server.origin, stop: stopFn });
    vi.mocked(captureRoutes).mockResolvedValue(undefined);
    vi.mocked(createBaseline).mockResolvedValue(makeManifest());
    vi.mocked(verifyBaseline).mockResolvedValue(makeManifest());
    vi.mocked(writeResult).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('runs the modules in order with the clock env var set and returns 0', async () => {
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(0);

    expect(callOrder(loadConfig)).toBeLessThan(callOrder(runBuild));
    expect(callOrder(runBuild)).toBeLessThan(callOrder(discoverRoutes));
    expect(callOrder(discoverRoutes)).toBeLessThan(callOrder(startServer));
    expect(callOrder(startServer)).toBeLessThan(callOrder(captureRoutes));
    expect(callOrder(captureRoutes)).toBeLessThan(callOrder(createBaseline));
    expect(callOrder(createBaseline)).toBeLessThan(callOrder(verifyBaseline));
    expect(callOrder(verifyBaseline)).toBeLessThan(callOrder(writeResult));

    const buildEnv = vi.mocked(runBuild).mock.calls[0]![1];
    expect(Object.keys(buildEnv)).toEqual(['VISUAL_TEST_DATE']);
    expect(buildEnv['VISUAL_TEST_DATE']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(vi.mocked(startServer).mock.calls[0]![1]).toEqual(buildEnv);

    const createOpts = vi.mocked(createBaseline).mock.calls[0]![0];
    expect(createOpts.identity.repository).toBe('acme/site');
    expect(createOpts.identity.baseBranch).toBe('main');
    expect(createOpts.identity.sourceSha).toBe(FULL_SHA);
    expect(createOpts.identity.workflowRunId).toBe('4242');
    expect(createOpts.identity.workflowRunAttempt).toBe(2);
    expect(createOpts.identity.logicalDate).toBe(buildEnv['VISUAL_TEST_DATE']);
    expect(createOpts.environment.containerDigest).toBe(CONTAINER_DIGEST);
    expect(createOpts.environment.platform).toBe(CONTAINER_PLATFORM);
    expect(createOpts.baselineDir).toBe(path.join(repoRoot, '.visual-regression/baseline'));

    const captureOpts = vi.mocked(captureRoutes).mock.calls[0]![0];
    expect(captureOpts.screenshotsDir).toBe(
      path.join(repoRoot, '.visual-regression/candidate/screenshots'),
    );
    expect(captureOpts.playwrightReportDir).toBe(path.join(repoRoot, 'playwright-report/visual'));
    expect(captureOpts.testResultsDir).toBe(path.join(repoRoot, 'test-results/visual'));
  });

  it('uses a pre-set clock env var value as the logical date (plan 8.2 job-start date)', async () => {
    vi.stubEnv('VISUAL_TEST_DATE', '2026-07-16');
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(0);

    const buildEnv = vi.mocked(runBuild).mock.calls[0]![1];
    expect(buildEnv['VISUAL_TEST_DATE']).toBe('2026-07-16');
    expect(vi.mocked(startServer).mock.calls[0]![1]).toEqual(buildEnv);
    expect(vi.mocked(captureRoutes).mock.calls[0]![0].logicalDate).toBe('2026-07-16');

    const createOpts = vi.mocked(createBaseline).mock.calls[0]![0];
    expect(createOpts.identity.logicalDate).toBe('2026-07-16');
  });

  it('accepts a pre-set full ISO-8601 UTC timestamp as the logical date', async () => {
    vi.stubEnv('VISUAL_TEST_DATE', '2026-07-16T00:00:00.000Z');
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(0);
    const createOpts = vi.mocked(createBaseline).mock.calls[0]![0];
    expect(createOpts.identity.logicalDate).toBe('2026-07-16T00:00:00.000Z');
  });

  it('rejects an invalid pre-set clock env var value with CONFIG_INVALID before building', async () => {
    vi.stubEnv('VISUAL_TEST_DATE', 'not-a-date');
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(1);
    expect(runBuild).not.toHaveBeenCalled();

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.status).toBe('infrastructure-error');
    expect(result.errors[0]!.code).toBe('CONFIG_INVALID');
    expect(result.errors[0]!.message).toContain('VISUAL_TEST_DATE');
  });

  it('writes a schema-shaped pass result', async () => {
    await runCli(['baseline', 'create']);
    const [resultDir, result] = vi.mocked(writeResult).mock.calls[0]!;
    expect(resultDir).toBe(path.join(repoRoot, '.visual-regression/result'));
    expect(result.operation).toBe('baseline-create');
    expect(result.status).toBe('pass');
    expect(result.candidateSha).toBe(FULL_SHA);
    expect(result.visualContractHash).toBe(CONTRACT_HASH);
    expect(result.baseline).toBeNull();
    expect(result.totals).toEqual({ routes: 1, screenshots: 3, changed: 0, added: 0, removed: 0 });
    expect(result.comparisons).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.reports.json).toBe('.visual-regression/result/visual-result.json');
    expect(result.reports.markdown).toBe('.visual-regression/result/visual-summary.md');
    expect(result.reports.html).toBe('playwright-report/visual/index.html');
  });

  it('clears and recreates the fixed output directories', async () => {
    await runCli(['baseline', 'create']);
    for (const dir of [
      '.visual-regression/candidate',
      '.visual-regression/baseline',
      '.visual-regression/result',
      'playwright-report/visual',
      'test-results/visual',
    ]) {
      expect(existsSync(path.join(repoRoot, dir))).toBe(true);
    }
  });

  it('stops the server even when captureRoutes rejects', async () => {
    vi.mocked(captureRoutes).mockRejectedValue(
      new VisualRegressionError('CAPTURE_FAILED', 'capture exploded', { context: { route: '/' } }),
    );
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(1);
    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(createBaseline).not.toHaveBeenCalled();

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.operation).toBe('baseline-create');
    expect(result.status).toBe('infrastructure-error');
    expect(result.errors[0]!.code).toBe('CAPTURE_FAILED');
    expect(result.errors[0]!.context).toEqual({ route: '/' });
  });

  it('returns 1 and writes an infrastructure-error result on BUILD_FAILED', async () => {
    vi.mocked(runBuild).mockRejectedValue(
      new VisualRegressionError('BUILD_FAILED', 'exit code 1', { context: { timeout: '120000' } }),
    );
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(1);
    expect(startServer).not.toHaveBeenCalled();

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.status).toBe('infrastructure-error');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('BUILD_FAILED');
    expect(result.errors[0]!.retryable).toBe(false);
    expect(result.totals).toEqual({ routes: 0, screenshots: 0, changed: 0, added: 0, removed: 0 });
    expect(result.reports.html).toBeNull();
  });

  it('wraps unexpected errors as INTERNAL_ERROR and still exits 1', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new TypeError('boom'));
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(1);
    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.errors[0]!.code).toBe('INTERNAL_ERROR');
    expect(result.errors[0]!.message).toBe('boom');
  });

  it('still exits 1 and logs when writing the failure result also fails', async () => {
    vi.mocked(runBuild).mockRejectedValue(new VisualRegressionError('BUILD_FAILED', 'nope'));
    vi.mocked(writeResult).mockRejectedValue(new Error('disk full'));
    const code = await runCli(['baseline', 'create']);
    expect(code).toBe(1);
    expect(stdio.stderr.join('')).toContain('disk full');
  });

  it('--json prints the final VisualResult as the only stdout output', async () => {
    const code = await runCli(['baseline', 'create', '--json']);
    expect(code).toBe(0);
    const stdout = stdio.stdout.join('');
    const parsed = JSON.parse(stdout) as { operation: string; status: string };
    expect(parsed.operation).toBe('baseline-create');
    expect(parsed.status).toBe('pass');
    expect(stdio.stderr.join('')).toContain('[info]');
  });

  it('--json prints an infrastructure-error result on failure', async () => {
    vi.mocked(runBuild).mockRejectedValue(new VisualRegressionError('BUILD_FAILED', 'nope'));
    const code = await runCli(['baseline', 'create', '--json']);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdio.stdout.join('')) as {
      status: string;
      errors: { code: string }[];
    };
    expect(parsed.status).toBe('infrastructure-error');
    expect(parsed.errors[0]!.code).toBe('BUILD_FAILED');
  });

  it('--host warns on stderr and records host identity', async () => {
    const code = await runCli(['baseline', 'create', '--host']);
    expect(code).toBe(0);
    expect(stdio.stderr.join('')).toMatch(/not authoritative/i);

    const createOpts = vi.mocked(createBaseline).mock.calls[0]![0];
    expect(createOpts.environment.containerDigest).toBe('host');
    expect(createOpts.environment.platform).toBe('host');

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.runtime.host).toBe(true);
  });
});
