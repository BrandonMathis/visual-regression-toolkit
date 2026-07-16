import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isVisualRegressionError } from '../../../src/errors.js';
import { compareAgainstBaseline, type CompareInputs } from '../../../src/result/index.js';
import {
  makeConfig,
  makeManifest,
  makeTempDir,
  pixelAt,
  setPixel,
  solidPng,
  writePngFile,
  type ManifestScreenshot,
} from './helpers.js';
import type { RouteDescriptor } from '../../../src/types.js';

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

let repoRoot: string;
let baselineDir: string;
let candidateDir: string;
let diffDir: string;

beforeEach(async () => {
  repoRoot = await makeTempDir();
  baselineDir = path.join(repoRoot, '.visual-regression', 'baseline');
  candidateDir = path.join(repoRoot, '.visual-regression', 'candidate', 'screenshots');
  diffDir = path.join(repoRoot, '.visual-regression', 'result', 'diffs');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

function inputs(
  routes: RouteDescriptor[],
  screenshots: ManifestScreenshot[],
  threshold = 0.2,
): CompareInputs {
  return {
    config: makeConfig(repoRoot, threshold),
    baselineDir,
    baselineManifest: makeManifest(routes, screenshots),
    candidateScreenshotsDir: candidateDir,
    diffDir,
  };
}

async function fileExists(absPath: string): Promise<boolean> {
  return readFile(absPath).then(
    () => true,
    () => false,
  );
}

describe('compareAgainstBaseline', () => {
  it('reports an identical pair as unchanged with no diff file', async () => {
    const png = solidPng(4, 4, WHITE);
    await writePngFile(path.join(baselineDir, 'screenshots', 'desktop', 'home.png'), png);
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), png);

    const outcome = await compareAgainstBaseline(
      inputs(
        [{ route: '/', screenshotName: 'home.png' }],
        [{ project: 'desktop', route: '/', name: 'home.png' }],
      ),
    );

    expect(outcome.changed).toBe(0);
    expect(outcome.added).toBe(0);
    expect(outcome.removed).toBe(0);
    expect(outcome.entries).toHaveLength(1);
    expect(outcome.entries[0]).toEqual({
      project: 'desktop',
      route: '/',
      screenshotName: 'home.png',
      status: 'unchanged',
      expectedPath: '.visual-regression/baseline/screenshots/desktop/home.png',
      actualPath: '.visual-regression/candidate/screenshots/desktop/home.png',
      diffPath: null,
      diffPixelRatio: 0,
    });
    expect(await fileExists(path.join(diffDir, 'desktop', 'home.png'))).toBe(false);
  });

  it('reports a one-pixel difference as changed with the correct ratio and a diff file', async () => {
    const expected = solidPng(4, 4, WHITE);
    const actual = solidPng(4, 4, WHITE);
    setPixel(actual, 2, 2, BLACK);
    await writePngFile(path.join(baselineDir, 'screenshots', 'desktop', 'home.png'), expected);
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), actual);

    const outcome = await compareAgainstBaseline(
      inputs(
        [{ route: '/', screenshotName: 'home.png' }],
        [{ project: 'desktop', route: '/', name: 'home.png' }],
      ),
    );

    expect(outcome.changed).toBe(1);
    const entry = outcome.entries[0];
    expect(entry?.status).toBe('changed');
    expect(entry?.diffPixelRatio).toBeCloseTo(1 / 16, 10);
    expect(entry?.diffPath).toBe('.visual-regression/result/diffs/desktop/home.png');
    const diff = PNG.sync.read(await readFile(path.join(diffDir, 'desktop', 'home.png')));
    expect(diff.width).toBe(4);
    expect(diff.height).toBe(4);
  });

  it('reports a dimension mismatch as changed with ratio 1 and a max-dimension diff', async () => {
    await writePngFile(
      path.join(baselineDir, 'screenshots', 'desktop', 'home.png'),
      solidPng(4, 4, WHITE),
    );
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), solidPng(6, 8, WHITE));

    const outcome = await compareAgainstBaseline(
      inputs(
        [{ route: '/', screenshotName: 'home.png' }],
        [{ project: 'desktop', route: '/', name: 'home.png', width: 4, height: 4 }],
      ),
    );

    expect(outcome.changed).toBe(1);
    const entry = outcome.entries[0];
    expect(entry?.status).toBe('changed');
    expect(entry?.diffPixelRatio).toBe(1);
    const diff = PNG.sync.read(await readFile(path.join(diffDir, 'desktop', 'home.png')));
    expect(diff.width).toBe(6);
    expect(diff.height).toBe(8);
    // Outside the 4x4 overlap: solid red.
    expect(pixelAt(diff, 5, 7)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(diff, 0, 6)).toEqual([255, 0, 0, 255]);
    // Inside the identical overlap: pixelmatch background, not solid red.
    expect(pixelAt(diff, 0, 0)[1]).toBeGreaterThan(0);
  });

  it('reports candidate-only screenshots as added', async () => {
    await writePngFile(path.join(candidateDir, 'desktop', 'about.png'), solidPng(4, 4, WHITE));

    const outcome = await compareAgainstBaseline(inputs([], []));

    expect(outcome.added).toBe(1);
    expect(outcome.entries[0]).toEqual({
      project: 'desktop',
      route: '/about',
      screenshotName: 'about.png',
      status: 'added',
      expectedPath: null,
      actualPath: '.visual-regression/candidate/screenshots/desktop/about.png',
      diffPath: null,
      diffPixelRatio: null,
    });
  });

  it('uses the manifest route for added screenshots whose name is a known route', async () => {
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), solidPng(4, 4, WHITE));

    const outcome = await compareAgainstBaseline(
      inputs([{ route: '/', screenshotName: 'home.png' }], []),
    );

    expect(outcome.entries[0]?.route).toBe('/');
  });

  it('reports baseline-only screenshots as removed', async () => {
    await mkdir(candidateDir, { recursive: true });
    await writePngFile(
      path.join(baselineDir, 'screenshots', 'phone', 'about.png'),
      solidPng(4, 4, WHITE),
    );

    const outcome = await compareAgainstBaseline(
      inputs(
        [{ route: '/about', screenshotName: 'about.png' }],
        [{ project: 'phone', route: '/about', name: 'about.png' }],
      ),
    );

    expect(outcome.removed).toBe(1);
    expect(outcome.entries[0]).toEqual({
      project: 'phone',
      route: '/about',
      screenshotName: 'about.png',
      status: 'removed',
      expectedPath: '.visual-regression/baseline/screenshots/phone/about.png',
      actualPath: null,
      diffPath: null,
      diffPixelRatio: null,
    });
  });

  it('throws CAPTURE_FAILED for a corrupt candidate PNG, naming the file', async () => {
    await writePngFile(
      path.join(baselineDir, 'screenshots', 'desktop', 'home.png'),
      solidPng(4, 4, WHITE),
    );
    await mkdir(path.join(candidateDir, 'desktop'), { recursive: true });
    await writeFile(path.join(candidateDir, 'desktop', 'home.png'), 'not a png', 'utf8');

    const promise = compareAgainstBaseline(
      inputs(
        [{ route: '/', screenshotName: 'home.png' }],
        [{ project: 'desktop', route: '/', name: 'home.png' }],
      ),
    );

    await expect(promise).rejects.toSatisfy(
      (error: unknown) =>
        isVisualRegressionError(error) &&
        error.code === 'CAPTURE_FAILED' &&
        error.message.includes('desktop/home.png'),
    );
  });

  it('throws CAPTURE_FAILED when the candidate screenshots directory is missing', async () => {
    await expect(compareAgainstBaseline(inputs([], []))).rejects.toSatisfy(
      (error: unknown) => isVisualRegressionError(error) && error.code === 'CAPTURE_FAILED',
    );
  });

  it('throws BASELINE_CORRUPT for a corrupt baseline PNG', async () => {
    await mkdir(path.join(baselineDir, 'screenshots', 'desktop'), { recursive: true });
    await writeFile(
      path.join(baselineDir, 'screenshots', 'desktop', 'home.png'),
      'not a png',
      'utf8',
    );
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), solidPng(4, 4, WHITE));

    const promise = compareAgainstBaseline(
      inputs(
        [{ route: '/', screenshotName: 'home.png' }],
        [{ project: 'desktop', route: '/', name: 'home.png' }],
      ),
    );

    await expect(promise).rejects.toSatisfy(
      (error: unknown) => isVisualRegressionError(error) && error.code === 'BASELINE_CORRUPT',
    );
  });

  it('is threshold sensitive: a subtle color shift passes at 1 and fails at 0', async () => {
    const expected = solidPng(4, 4, [120, 120, 120]);
    const actual = solidPng(4, 4, [120, 120, 120]);
    setPixel(actual, 1, 1, [126, 120, 120]);
    await writePngFile(path.join(baselineDir, 'screenshots', 'desktop', 'home.png'), expected);
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), actual);

    const routes: RouteDescriptor[] = [{ route: '/', screenshotName: 'home.png' }];
    const screenshots: ManifestScreenshot[] = [
      { project: 'desktop', route: '/', name: 'home.png' },
    ];

    const lenient = await compareAgainstBaseline(inputs(routes, screenshots, 1));
    expect(lenient.changed).toBe(0);
    expect(lenient.entries[0]?.status).toBe('unchanged');

    const strict = await compareAgainstBaseline(inputs(routes, screenshots, 0));
    expect(strict.changed).toBe(1);
    expect(strict.entries[0]?.status).toBe('changed');
  });

  it('includes all pairs sorted by project then route', async () => {
    const png = solidPng(4, 4, WHITE);
    await writePngFile(path.join(baselineDir, 'screenshots', 'desktop', 'home.png'), png);
    await writePngFile(path.join(baselineDir, 'screenshots', 'desktop', 'about.png'), png);
    await writePngFile(path.join(baselineDir, 'screenshots', 'phone', 'home.png'), png);
    await writePngFile(path.join(candidateDir, 'desktop', 'home.png'), png);
    await writePngFile(path.join(candidateDir, 'desktop', 'about.png'), png);
    await writePngFile(path.join(candidateDir, 'phone', 'zebra.png'), png);

    const outcome = await compareAgainstBaseline(
      inputs(
        [
          { route: '/', screenshotName: 'home.png' },
          { route: '/about', screenshotName: 'about.png' },
        ],
        [
          { project: 'desktop', route: '/', name: 'home.png' },
          { project: 'desktop', route: '/about', name: 'about.png' },
          { project: 'phone', route: '/', name: 'home.png' },
        ],
      ),
    );

    expect(outcome.entries.map((entry) => [entry.project, entry.route, entry.status])).toEqual([
      ['desktop', '/', 'unchanged'],
      ['desktop', '/about', 'unchanged'],
      ['phone', '/', 'removed'],
      ['phone', '/zebra', 'added'],
    ]);
  });
});
