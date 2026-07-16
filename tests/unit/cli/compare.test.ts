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

import { checkBaselineCompatibility, verifyBaseline } from '../../../src/baseline/index.js';
import { captureRoutes, runBuild, startServer } from '../../../src/capture/index.js';
import { runCli } from '../../../src/cli/index.js';
import { computeVisualContractHash, loadConfig } from '../../../src/config/index.js';
import { discoverRoutes } from '../../../src/discovery/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { compareAgainstBaseline, writeResult } from '../../../src/result/index.js';
import {
  BASELINE_MANIFEST_SCHEMA_VERSION,
  CHROMIUM_REVISION,
  CONTAINER_DIGEST,
  CONTAINER_PLATFORM,
  PLAYWRIGHT_VERSION,
} from '../../../src/runtime.js';
import type { ComparisonEntry } from '../../../src/types.js';
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

const LOGICAL_DATE = '2025-06-15T12:00:00.000Z';
const BASELINE_ARG = 'downloaded-baseline';

function changedEntry(): ComparisonEntry {
  return {
    project: 'desktop',
    route: '/',
    screenshotName: 'home.png',
    status: 'changed',
    expectedPath: 'downloaded-baseline/screenshots/desktop/home.png',
    actualPath: '.visual-regression/candidate/screenshots/desktop/home.png',
    diffPath: '.visual-regression/result/diffs/desktop/home.png',
    diffPixelRatio: 0.01,
  };
}

function unchangedEntry(): ComparisonEntry {
  return {
    project: 'tablet',
    route: '/',
    screenshotName: 'home.png',
    status: 'unchanged',
    expectedPath: 'downloaded-baseline/screenshots/tablet/home.png',
    actualPath: '.visual-regression/candidate/screenshots/tablet/home.png',
    diffPath: null,
    diffPixelRatio: 0,
  };
}

describe('compare', () => {
  let repoRoot: string;
  let stdio: CapturedStdio;
  let stopFn: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await makeRepoRoot();
    stubGitHubEnv();
    stdio = captureStdio();
    const config = makeConfig(repoRoot);
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(computeVisualContractHash).mockReturnValue(CONTRACT_HASH);
    vi.mocked(verifyBaseline).mockResolvedValue(makeManifest({ logicalDate: LOGICAL_DATE }));
    vi.mocked(checkBaselineCompatibility).mockReturnValue(undefined);
    vi.mocked(runBuild).mockResolvedValue(undefined);
    vi.mocked(discoverRoutes).mockResolvedValue([{ route: '/', screenshotName: 'home.png' }]);
    stopFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(startServer).mockResolvedValue({ origin: config.server.origin, stop: stopFn });
    vi.mocked(captureRoutes).mockResolvedValue(undefined);
    vi.mocked(compareAgainstBaseline).mockResolvedValue({
      entries: [unchangedEntry()],
      changed: 0,
      added: 0,
      removed: 0,
    });
    vi.mocked(writeResult).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('passes with exit 0 and uses the baseline manifest logicalDate for the clock env', async () => {
    const code = await runCli(['compare', '--baseline', BASELINE_ARG]);
    expect(code).toBe(0);

    expect(verifyBaseline).toHaveBeenCalledWith(path.join(repoRoot, BASELINE_ARG));
    const verifyOrder = vi.mocked(verifyBaseline).mock.invocationCallOrder[0]!;
    const buildOrder = vi.mocked(runBuild).mock.invocationCallOrder[0]!;
    expect(verifyOrder).toBeLessThan(buildOrder);

    const buildEnv = vi.mocked(runBuild).mock.calls[0]![1];
    expect(buildEnv).toEqual({ VISUAL_TEST_DATE: LOGICAL_DATE });
    expect(vi.mocked(startServer).mock.calls[0]![1]).toEqual(buildEnv);
    expect(vi.mocked(captureRoutes).mock.calls[0]![0].logicalDate).toBe(LOGICAL_DATE);

    const compareInputs = vi.mocked(compareAgainstBaseline).mock.calls[0]![0];
    expect(compareInputs.baselineDir).toBe(path.join(repoRoot, BASELINE_ARG));
    expect(compareInputs.diffDir).toBe(path.join(repoRoot, '.visual-regression/result/diffs'));

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.operation).toBe('compare');
    expect(result.status).toBe('pass');
    expect(result.candidateSha).toBe(FULL_SHA);
    expect(result.baseline).toEqual({
      sourceSha: FULL_SHA,
      visualContractHash: CONTRACT_HASH,
      toolkitVersion: '1.0.0',
      playwrightVersion: PLAYWRIGHT_VERSION,
      chromiumRevision: CHROMIUM_REVISION,
      containerDigest: CONTAINER_DIGEST,
      platform: CONTAINER_PLATFORM,
    });
    expect(result.totals).toEqual({ routes: 1, screenshots: 3, changed: 0, added: 0, removed: 0 });
    expect(result.comparisons).toEqual([]);
  });

  it('checks compatibility against env identity and the candidate hash', async () => {
    await runCli(['compare', '--baseline', BASELINE_ARG]);
    expect(checkBaselineCompatibility).toHaveBeenCalledWith(
      expect.objectContaining({ logicalDate: LOGICAL_DATE }),
      {
        repository: 'acme/site',
        sourceSha: FULL_SHA,
        visualContractHash: CONTRACT_HASH,
        toolkitMajor: 1,
        schemaVersion: BASELINE_MANIFEST_SCHEMA_VERSION,
        playwrightVersion: PLAYWRIGHT_VERSION,
        chromiumRevision: CHROMIUM_REVISION,
        containerDigest: CONTAINER_DIGEST,
        platform: CONTAINER_PLATFORM,
      },
    );
  });

  it('honors --expect-base-sha and --expect-repository', async () => {
    const expectedSha = 'b'.repeat(40);
    await runCli([
      'compare',
      '--baseline',
      BASELINE_ARG,
      '--expect-base-sha',
      expectedSha,
      '--expect-repository',
      'acme/other',
    ]);
    const expected = vi.mocked(checkBaselineCompatibility).mock.calls[0]![1];
    expect(expected.sourceSha).toBe(expectedSha);
    expect(expected.repository).toBe('acme/other');
  });

  it('returns 2 with status visual-diff when the comparison finds changes', async () => {
    vi.mocked(compareAgainstBaseline).mockResolvedValue({
      entries: [changedEntry(), unchangedEntry()],
      changed: 1,
      added: 0,
      removed: 0,
    });
    const code = await runCli(['compare', '--baseline', BASELINE_ARG]);
    expect(code).toBe(2);

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.status).toBe('visual-diff');
    expect(result.totals.changed).toBe(1);
    expect(result.comparisons).toEqual([changedEntry()]);
  });

  it('--json emits the visual-diff result as parseable stdout-only JSON', async () => {
    vi.mocked(compareAgainstBaseline).mockResolvedValue({
      entries: [changedEntry()],
      changed: 1,
      added: 0,
      removed: 0,
    });
    const code = await runCli(['compare', '--baseline', BASELINE_ARG, '--json']);
    expect(code).toBe(2);
    const parsed = JSON.parse(stdio.stdout.join('')) as { status: string; operation: string };
    expect(parsed.status).toBe('visual-diff');
    expect(parsed.operation).toBe('compare');
  });

  it('--host warns and compares compatibility using the manifest container identity', async () => {
    vi.mocked(verifyBaseline).mockResolvedValue(
      makeManifest({
        logicalDate: LOGICAL_DATE,
        environment: {
          os: 'linux',
          arch: 'x64',
          containerDigest: 'sha256:baseline-digest',
          platform: 'linux/amd64',
        },
      }),
    );
    const code = await runCli(['compare', '--baseline', BASELINE_ARG, '--host']);
    expect(code).toBe(0);
    expect(stdio.stderr.join('')).toMatch(/not authoritative/i);
    expect(stdio.stderr.join('')).toMatch(/not comparable/i);

    const expected = vi.mocked(checkBaselineCompatibility).mock.calls[0]![1];
    expect(expected.containerDigest).toBe('sha256:baseline-digest');
    expect(expected.platform).toBe('linux/amd64');

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.runtime.host).toBe(true);
  });

  it('refuses a --baseline path inside the cleared output dirs with CONFIG_INVALID', async () => {
    const code = await runCli(['compare', '--baseline', '.visual-regression/baseline']);
    expect(code).toBe(1);
    expect(verifyBaseline).not.toHaveBeenCalled();
    expect(runBuild).not.toHaveBeenCalled();

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.status).toBe('infrastructure-error');
    expect(result.errors[0]!.code).toBe('CONFIG_INVALID');
  });

  it('stops the server even when captureRoutes rejects and never exits 2', async () => {
    vi.mocked(captureRoutes).mockRejectedValue(
      new VisualRegressionError('CAPTURE_FAILED', 'timed out', { context: { route: '/' } }),
    );
    const code = await runCli(['compare', '--baseline', BASELINE_ARG]);
    expect(code).toBe(1);
    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(compareAgainstBaseline).not.toHaveBeenCalled();

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.status).toBe('infrastructure-error');
    expect(result.errors[0]!.code).toBe('CAPTURE_FAILED');
  });

  it('returns 1 with a written infrastructure-error result on BUILD_FAILED', async () => {
    vi.mocked(runBuild).mockRejectedValue(new VisualRegressionError('BUILD_FAILED', 'exit 1'));
    const code = await runCli(['compare', '--baseline', BASELINE_ARG]);
    expect(code).toBe(1);

    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.operation).toBe('compare');
    expect(result.status).toBe('infrastructure-error');
    expect(result.errors[0]!.code).toBe('BUILD_FAILED');
    // The verified baseline identity is preserved for diagnostics.
    expect(result.baseline).not.toBeNull();
    expect(result.baseline!.sourceSha).toBe(FULL_SHA);
  });

  it('maps an incompatible baseline to exit 1, never 2', async () => {
    vi.mocked(checkBaselineCompatibility).mockImplementation(() => {
      throw new VisualRegressionError('BASELINE_INCOMPATIBLE', 'wrong runtime');
    });
    const code = await runCli(['compare', '--baseline', BASELINE_ARG]);
    expect(code).toBe(1);
    expect(runBuild).not.toHaveBeenCalled();
    const result = vi.mocked(writeResult).mock.calls[0]![1];
    expect(result.errors[0]!.code).toBe('BASELINE_INCOMPATIBLE');
  });

  it('fails with exit 1 when --baseline is missing', async () => {
    const code = await runCli(['compare']);
    expect(code).toBe(1);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(stdio.stderr.join('')).toContain('--baseline');
  });
});
