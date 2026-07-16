/**
 * Full-lifecycle end-to-end suite driving the BUILT CLI (dist/cli/bin.js)
 * against the fixture Next.js app in --host diagnostic mode.
 *
 * This suite is the substance behind the `npm run test:e2e` release gate
 * (docs/release.md step 1, plan.md section 14): without it the script exits 1
 * with "No test files found". Run `npm run build` first — the suite executes
 * the compiled CLI, not the TypeScript sources.
 *
 * --host applies on every platform, including linux: the CI e2e job runs in
 * the pinned Playwright container, and --host there is a deliberate
 * diagnostic-mode run that keeps the gate independent of container-identity
 * bookkeeping (host runs reuse the baseline manifest's container identity).
 *
 * The phases share state (a baseline created in phase 1 is copied and reused
 * by later phases), so they live in one describe block in dependency order;
 * vitest runs the tests of a single file serially, and vitest.config.ts pins
 * pool 'forks', so no two phases ever overlap.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const binPath = path.join(repoRoot, 'dist', 'cli', 'bin.js');
const fixtureDir = path.join(repoRoot, 'tests', 'fixtures', 'next-app');
const globalsCssPath = path.join(fixtureDir, 'app', 'globals.css');
const homePagePath = path.join(fixtureDir, 'app', 'page.js');
const baselineOutDir = path.join(fixtureDir, '.visual-regression', 'baseline');

/** Each phase builds the fixture app and captures 15 screenshots. */
const STEP_TIMEOUT_MS = 480_000;
const TEST_TIMEOUT_MS = 600_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

const EXPECTED_ROUTES = 5;
const EXPECTED_SCREENSHOTS = 15;

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

interface ResultTotals {
  routes: number;
  screenshots: number;
  changed: number;
  added: number;
  removed: number;
}

interface ResultComparison {
  project: string;
  route: string;
  status: string;
  diffPath: string | null;
}

interface ResultError {
  code: string;
  message: string;
}

interface VisualResultJson {
  operation: string;
  status: string;
  totals: ResultTotals;
  comparisons: ResultComparison[];
  errors: ResultError[];
}

function runCli(args: string[]): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [binPath, ...args],
      {
        cwd: fixtureDir,
        env: process.env,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: STEP_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === 'number') {
          resolve({ code, stdout, stderr });
          return;
        }
        // Spawn failure or timeout kill: no exit code to assert on.
        reject(
          new Error(
            `CLI did not exit cleanly (${String(code)}): ${error.message}\nstderr:\n${stderr}`,
          ),
        );
      },
    );
  });
}

function parseResult(run: CliRun): VisualResultJson {
  try {
    return JSON.parse(run.stdout) as VisualResultJson;
  } catch (cause) {
    throw new Error(
      `Expected --json stdout to be a single JSON document, got:\n${run.stdout}\nstderr:\n${run.stderr}`,
      { cause },
    );
  }
}

async function listPngs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((e) => e.name);
}

const STARK_CSS_OVERRIDE = `
/* e2e: stark change so every route diffs above the 0.2 pixelmatch threshold */
body {
  background: #1a1a6e;
  color: #f9fafb;
}
`;

const BUILD_BREAKER = '\nthis is not valid javascript ((( {{{\n';

let baselineCopyDir: string | null = null;
let originalGlobalsCss: Buffer | undefined;
let originalHomePage: Buffer | undefined;

function captured(buf: Buffer | undefined, name: string): Buffer {
  if (buf === undefined) throw new Error(`${name} was not captured in beforeAll`);
  return buf;
}

describe('full lifecycle against the built CLI (fixture next-app, --host)', () => {
  beforeAll(async () => {
    expect(
      existsSync(binPath),
      `Built CLI not found at ${binPath}; run \`npm run build\` before \`npm run test:e2e\``,
    ).toBe(true);
    // Captured up front so afterAll can always restore the fixture sources,
    // even if a phase dies between mutate and its own finally-restore.
    originalGlobalsCss = await readFile(globalsCssPath);
    originalHomePage = await readFile(homePagePath);
  });

  afterAll(async () => {
    // beforeAll may have failed before the originals were read.
    if (originalGlobalsCss !== undefined) await writeFile(globalsCssPath, originalGlobalsCss);
    if (originalHomePage !== undefined) await writeFile(homePagePath, originalHomePage);
    for (const dir of ['.visual-regression', 'playwright-report', 'test-results']) {
      await rm(path.join(fixtureDir, dir), { recursive: true, force: true });
    }
    if (baselineCopyDir !== null) {
      await rm(baselineCopyDir, { recursive: true, force: true });
    }
  });

  it(
    'baseline create --host --json captures a complete verified baseline',
    async () => {
      const run = await runCli(['baseline', 'create', '--host', '--json']);
      expect(run.code, `stderr:\n${run.stderr}`).toBe(0);

      const result = parseResult(run);
      expect(result.operation).toBe('baseline-create');
      expect(result.status).toBe('pass');
      expect(result.errors).toEqual([]);
      expect(result.totals.routes).toBe(EXPECTED_ROUTES);
      expect(result.totals.screenshots).toBe(EXPECTED_SCREENSHOTS);

      expect(existsSync(path.join(baselineOutDir, 'baseline-manifest.json'))).toBe(true);
      const pngs = await listPngs(path.join(baselineOutDir, 'screenshots'));
      expect(pngs).toHaveLength(EXPECTED_SCREENSHOTS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'baseline verify accepts a copy of the created baseline',
    async () => {
      // The baseline must live outside .visual-regression/: compare clears
      // the fixed output dirs (including .visual-regression/baseline) before
      // capturing, and the CLI rejects --baseline paths inside them.
      baselineCopyDir = await mkdtemp(path.join(tmpdir(), 'vr-e2e-baseline-'));
      await cp(baselineOutDir, baselineCopyDir, { recursive: true });

      const run = await runCli(['baseline', 'verify', baselineCopyDir, '--json']);
      expect(run.code, `stderr:\n${run.stderr}`).toBe(0);
      const summary = JSON.parse(run.stdout) as { status: string; screenshots: number };
      expect(summary.status).toBe('ok');
      expect(summary.screenshots).toBe(EXPECTED_SCREENSHOTS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'compare against the unchanged fixture passes with zero differences',
    async () => {
      expect(baselineCopyDir).not.toBeNull();
      const run = await runCli([
        'compare',
        '--baseline',
        baselineCopyDir as string,
        '--host',
        '--json',
      ]);
      expect(run.code, `stderr:\n${run.stderr}`).toBe(0);

      const result = parseResult(run);
      expect(result.operation).toBe('compare');
      expect(result.status).toBe('pass');
      expect(result.errors).toEqual([]);
      expect(result.totals.routes).toBe(EXPECTED_ROUTES);
      expect(result.totals.screenshots).toBe(EXPECTED_SCREENSHOTS);
      expect(result.totals.changed).toBe(0);
      expect(result.totals.added).toBe(0);
      expect(result.totals.removed).toBe(0);
      expect(result.comparisons).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'compare after a stark CSS change reports visual-diff on every screenshot (exit 2)',
    async () => {
      expect(baselineCopyDir).not.toBeNull();
      await writeFile(
        globalsCssPath,
        `${captured(originalGlobalsCss, 'globals.css').toString('utf8')}${STARK_CSS_OVERRIDE}`,
      );
      try {
        const run = await runCli([
          'compare',
          '--baseline',
          baselineCopyDir as string,
          '--host',
          '--json',
        ]);
        expect(run.code, `stderr:\n${run.stderr}`).toBe(2);

        const result = parseResult(run);
        expect(result.operation).toBe('compare');
        expect(result.status).toBe('visual-diff');
        expect(result.errors).toEqual([]);
        expect(result.totals.changed).toBe(EXPECTED_SCREENSHOTS);
        expect(result.totals.added).toBe(0);
        expect(result.totals.removed).toBe(0);

        const changedEntries = result.comparisons.filter((entry) => entry.status === 'changed');
        expect(changedEntries).toHaveLength(EXPECTED_SCREENSHOTS);
        for (const entry of changedEntries) {
          expect(entry.diffPath, `${entry.project} ${entry.route} has no diff PNG`).not.toBeNull();
          const diffAbsPath = path.join(fixtureDir, ...(entry.diffPath as string).split('/'));
          const diffStat = await stat(diffAbsPath);
          expect(diffStat.isFile()).toBe(true);
          expect(diffStat.size).toBeGreaterThan(0);
        }
      } finally {
        await writeFile(globalsCssPath, captured(originalGlobalsCss, 'globals.css'));
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'compare with a broken fixture build fails as infrastructure-error BUILD_FAILED (exit 1)',
    async () => {
      expect(baselineCopyDir).not.toBeNull();
      await writeFile(
        homePagePath,
        `${captured(originalHomePage, 'page.js').toString('utf8')}${BUILD_BREAKER}`,
      );
      try {
        const run = await runCli([
          'compare',
          '--baseline',
          baselineCopyDir as string,
          '--host',
          '--json',
        ]);
        expect(run.code, `stderr:\n${run.stderr}`).toBe(1);

        const result = parseResult(run);
        expect(result.operation).toBe('compare');
        expect(result.status).toBe('infrastructure-error');
        expect(result.errors[0]?.code).toBe('BUILD_FAILED');
      } finally {
        await writeFile(homePagePath, captured(originalHomePage, 'page.js'));
      }
    },
    TEST_TIMEOUT_MS,
  );
});
