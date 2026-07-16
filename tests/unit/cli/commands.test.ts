import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { verifyBaseline } from '../../../src/baseline/index.js';
import { runCli } from '../../../src/cli/index.js';
import { computeVisualContractHash, loadConfig } from '../../../src/config/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
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

describe('cli commands', () => {
  let repoRoot: string;
  let stdio: CapturedStdio;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await makeRepoRoot();
    stubGitHubEnv();
    stdio = captureStdio();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(repoRoot, { recursive: true, force: true });
  });

  describe('baseline verify', () => {
    it('prints an identity summary and returns 0 on success', async () => {
      vi.mocked(verifyBaseline).mockResolvedValue(makeManifest());
      const code = await runCli(['baseline', 'verify', 'some/baseline']);
      expect(code).toBe(0);
      expect(verifyBaseline).toHaveBeenCalledWith(path.join(repoRoot, 'some/baseline'));
      const stdout = stdio.stdout.join('');
      expect(stdout).toContain('baseline: ok');
      expect(stdout).toContain(`sourceSha: ${FULL_SHA}`);
      expect(stdout).toContain(`visualContractHash: ${CONTRACT_HASH}`);
      expect(stdout).toContain('screenshots: 3');
    });

    it('prints machine JSON with --json', async () => {
      vi.mocked(verifyBaseline).mockResolvedValue(makeManifest());
      const code = await runCli(['baseline', 'verify', 'some/baseline', '--json']);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdio.stdout.join('')) as Record<string, unknown>;
      expect(parsed).toEqual({
        status: 'ok',
        sourceSha: FULL_SHA,
        visualContractHash: CONTRACT_HASH,
        toolkitVersion: '1.0.0',
        screenshots: 3,
      });
    });

    it('returns 1 with a stderr code on failure', async () => {
      vi.mocked(verifyBaseline).mockRejectedValue(
        new VisualRegressionError('BASELINE_CORRUPT', 'checksum mismatch', {
          context: { path: 'screenshots/desktop/home.png' },
        }),
      );
      const code = await runCli(['baseline', 'verify', 'some/baseline']);
      expect(code).toBe(1);
      expect(stdio.stdout.join('')).toBe('');
      expect(stdio.stderr.join('')).toContain('BASELINE_CORRUPT');
    });

    it('requires the <dir> argument', async () => {
      const code = await runCli(['baseline', 'verify']);
      expect(code).toBe(1);
      expect(verifyBaseline).not.toHaveBeenCalled();
    });

    describe('runtime compatibility (plan 5.4)', () => {
      it('rejects a mismatched playwrightVersion with BASELINE_INCOMPATIBLE and exit 1', async () => {
        vi.mocked(verifyBaseline).mockResolvedValue(makeManifest({ playwrightVersion: '1.50.0' }));
        const code = await runCli(['baseline', 'verify', 'some/baseline']);
        expect(code).toBe(1);
        expect(stdio.stdout.join('')).toBe('');
        const stderr = stdio.stderr.join('');
        expect(stderr).toContain('BASELINE_INCOMPATIBLE');
        expect(stderr).toContain('playwrightVersion');
      });

      it('rejects a mismatched chromiumRevision', async () => {
        vi.mocked(verifyBaseline).mockResolvedValue(makeManifest({ chromiumRevision: '999' }));
        const code = await runCli(['baseline', 'verify', 'some/baseline']);
        expect(code).toBe(1);
        expect(stdio.stderr.join('')).toContain('chromiumRevision');
      });

      it('rejects a different toolkit major version', async () => {
        vi.mocked(verifyBaseline).mockResolvedValue(
          makeManifest({ toolkit: { name: '@thisdot/visual-regression', version: '2.0.0' } }),
        );
        const code = await runCli(['baseline', 'verify', 'some/baseline']);
        expect(code).toBe(1);
        expect(stdio.stderr.join('')).toContain('toolkitMajor');
      });

      it('rejects a different manifest schemaVersion', async () => {
        vi.mocked(verifyBaseline).mockResolvedValue(makeManifest({ schemaVersion: 2 }));
        const code = await runCli(['baseline', 'verify', 'some/baseline']);
        expect(code).toBe(1);
        expect(stdio.stderr.join('')).toContain('schemaVersion');
      });

      it('rejects an unknown containerDigest', async () => {
        vi.mocked(verifyBaseline).mockResolvedValue(
          makeManifest({
            environment: {
              os: 'linux',
              arch: 'x64',
              containerDigest: `sha256:${'1'.repeat(64)}`,
              platform: 'linux/amd64',
            },
          }),
        );
        const code = await runCli(['baseline', 'verify', 'some/baseline']);
        expect(code).toBe(1);
        expect(stdio.stderr.join('')).toContain('containerDigest');
      });

      it("accepts containerDigest 'host' with a diagnostic-only warning", async () => {
        vi.mocked(verifyBaseline).mockResolvedValue(
          makeManifest({
            environment: { os: 'darwin', arch: 'arm64', containerDigest: 'host', platform: 'host' },
          }),
        );
        const code = await runCli(['baseline', 'verify', 'some/baseline']);
        expect(code).toBe(0);
        expect(stdio.stdout.join('')).toContain('baseline: ok');
        expect(stdio.stderr.join('')).toMatch(/diagnostic-only/i);
      });
    });
  });

  describe('config hash', () => {
    beforeEach(() => {
      vi.mocked(loadConfig).mockResolvedValue(makeConfig(repoRoot));
      vi.mocked(computeVisualContractHash).mockReturnValue(CONTRACT_HASH);
    });

    it('prints the visual-contract hash on stdout', async () => {
      const code = await runCli(['config', 'hash']);
      expect(code).toBe(0);
      expect(stdio.stdout.join('')).toBe(`${CONTRACT_HASH}\n`);
      expect(loadConfig).toHaveBeenCalledWith(
        path.join(repoRoot, 'visual-regression.config.ts'),
        repoRoot,
      );
    });

    it('respects --config and --json', async () => {
      const code = await runCli(['config', 'hash', '--config', 'custom.config.ts', '--json']);
      expect(code).toBe(0);
      expect(loadConfig).toHaveBeenCalledWith(path.join(repoRoot, 'custom.config.ts'), repoRoot);
      const parsed = JSON.parse(stdio.stdout.join('')) as Record<string, unknown>;
      expect(parsed).toEqual({ visualContractHash: CONTRACT_HASH });
    });

    it('returns 1 when the config cannot be loaded', async () => {
      vi.mocked(loadConfig).mockRejectedValue(
        new VisualRegressionError('CONFIG_NOT_FOUND', 'no config file', {
          context: { path: 'visual-regression.config.ts' },
        }),
      );
      const code = await runCli(['config', 'hash']);
      expect(code).toBe(1);
      expect(stdio.stdout.join('')).toBe('');
      expect(stdio.stderr.join('')).toContain('CONFIG_NOT_FOUND');
    });
  });

  describe('report', () => {
    it('prints the absolute report path when the HTML report exists', async () => {
      const reportDir = path.join(repoRoot, 'playwright-report/visual');
      await mkdir(reportDir, { recursive: true });
      await writeFile(path.join(reportDir, 'index.html'), '<html></html>');

      const code = await runCli(['report']);
      expect(code).toBe(0);
      const expected = path.join(repoRoot, 'playwright-report/visual/index.html');
      expect(stdio.stdout.join('')).toBe(`${expected}\n`);
      expect(stdio.stderr.join('')).toContain('Open it in a browser');
    });

    it('supports --json', async () => {
      const reportDir = path.join(repoRoot, 'playwright-report/visual');
      await mkdir(reportDir, { recursive: true });
      await writeFile(path.join(reportDir, 'index.html'), '<html></html>');

      const code = await runCli(['report', '--json']);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdio.stdout.join('')) as { reportPath: string };
      expect(parsed.reportPath).toBe(path.join(repoRoot, 'playwright-report/visual/index.html'));
    });

    it('returns 1 with a stderr note when no report exists', async () => {
      const code = await runCli(['report']);
      expect(code).toBe(1);
      expect(stdio.stdout.join('')).toBe('');
      expect(stdio.stderr.join('')).toContain('No Playwright HTML report found');
    });
  });

  describe('argument handling', () => {
    it('returns 1 for an unknown flag without running any module', async () => {
      const code = await runCli(['baseline', 'create', '--bogus']);
      expect(code).toBe(1);
      expect(loadConfig).not.toHaveBeenCalled();
      expect(stdio.stderr.join('')).toContain('--bogus');
    });

    it('returns 1 for an unknown command', async () => {
      const code = await runCli(['frobnicate']);
      expect(code).toBe(1);
    });

    it('returns 0 for --help', async () => {
      const code = await runCli(['--help']);
      expect(code).toBe(0);
    });
  });
});
