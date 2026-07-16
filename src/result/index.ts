/**
 * Comparison and the visual-result contract (plan §10).
 *
 * Comparison pairs every baseline-manifest screenshot with candidate PNGs
 * found at <candidateScreenshotsDir>/<project>/<name>.png. Both-side pairs
 * are pixelmatched at the configured threshold; dimension mismatches are
 * 'changed' with ratio 1 and a diff canvas sized to the max dimensions.
 * Results are validated against schemas/visual-result.schema.json plus
 * cross-field rules ajv cannot express.
 */
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { VisualRegressionError } from '../errors.js';
import { RESULT_JSON_NAME, RESULT_SUMMARY_NAME } from '../paths.js';
import { renderMarkdownSummary } from '../reporters/index.js';
import type {
  BaselineManifest,
  ComparisonEntry,
  ResolvedVisualConfig,
  VisualResult,
} from '../types.js';

export interface CompareInputs {
  config: ResolvedVisualConfig;
  baselineDir: string;
  baselineManifest: BaselineManifest;
  /** Candidate screenshots at <candidateScreenshotsDir>/<project>/<name>. */
  candidateScreenshotsDir: string;
  /** Diff PNGs are written to <diffDir>/<project>/<name>. */
  diffDir: string;
}

export interface ComparisonOutcome {
  entries: ComparisonEntry[];
  changed: number;
  added: number;
  removed: number;
}

interface ScreenshotFile {
  project: string;
  name: string;
  route: string;
  absPath: string;
}

const MAX_LISTED_SCHEMA_ERRORS = 5;

function toRepoRelative(repoRoot: string, absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

/** Best-effort inverse of route -> screenshot naming for candidate-only files. */
function routeForScreenshotName(name: string): string {
  const stem = name.replace(/\.png$/, '');
  return stem === 'home' ? '/' : `/${stem}`;
}

async function readPng(
  absPath: string,
  side: 'candidate' | 'baseline',
  context: Record<string, string>,
): Promise<PNG> {
  try {
    return PNG.sync.read(await readFile(absPath));
  } catch (cause) {
    if (side === 'candidate') {
      throw new VisualRegressionError(
        'CAPTURE_FAILED',
        `Candidate screenshot is unreadable or corrupt: ${context['path'] ?? absPath}`,
        { context, cause },
      );
    }
    throw new VisualRegressionError(
      'BASELINE_CORRUPT',
      `Baseline screenshot is unreadable or corrupt: ${context['path'] ?? absPath}`,
      { context, cause },
    );
  }
}

async function listCandidateScreenshots(
  candidateScreenshotsDir: string,
  routeByName: Map<string, string>,
): Promise<Map<string, ScreenshotFile>> {
  const candidates = new Map<string, ScreenshotFile>();
  let projectDirs;
  try {
    projectDirs = await readdir(candidateScreenshotsDir, { withFileTypes: true });
  } catch (cause) {
    throw new VisualRegressionError(
      'CAPTURE_FAILED',
      `Candidate screenshots directory is unreadable: ${candidateScreenshotsDir}`,
      { context: { path: candidateScreenshotsDir }, cause },
    );
  }
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const files = await readdir(path.join(candidateScreenshotsDir, projectDir.name), {
      withFileTypes: true,
    });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.png')) continue;
      candidates.set(`${projectDir.name}/${file.name}`, {
        project: projectDir.name,
        name: file.name,
        route: routeByName.get(file.name) ?? routeForScreenshotName(file.name),
        absPath: path.join(candidateScreenshotsDir, projectDir.name, file.name),
      });
    }
  }
  return candidates;
}

/**
 * Max-dimension canvas: solid red where only one image has pixels, the
 * pixelmatch diff of the top-left overlap elsewhere.
 */
function dimensionMismatchDiff(expected: PNG, actual: PNG, threshold: number): PNG {
  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const overlapWidth = Math.min(expected.width, actual.width);
  const overlapHeight = Math.min(expected.height, actual.height);

  const diff = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    diff.data[i * 4] = 255;
    diff.data[i * 4 + 1] = 0;
    diff.data[i * 4 + 2] = 0;
    diff.data[i * 4 + 3] = 255;
  }

  if (overlapWidth > 0 && overlapHeight > 0) {
    const expectedOverlap = new PNG({ width: overlapWidth, height: overlapHeight });
    const actualOverlap = new PNG({ width: overlapWidth, height: overlapHeight });
    PNG.bitblt(expected, expectedOverlap, 0, 0, overlapWidth, overlapHeight, 0, 0);
    PNG.bitblt(actual, actualOverlap, 0, 0, overlapWidth, overlapHeight, 0, 0);
    const overlapDiff = new PNG({ width: overlapWidth, height: overlapHeight });
    pixelmatch(
      expectedOverlap.data,
      actualOverlap.data,
      overlapDiff.data,
      overlapWidth,
      overlapHeight,
      {
        threshold,
        includeAA: false,
      },
    );
    PNG.bitblt(overlapDiff, diff, 0, 0, overlapWidth, overlapHeight, 0, 0);
  }
  return diff;
}

async function writeDiffPng(absPath: string, diff: PNG): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, PNG.sync.write(diff));
}

export async function compareAgainstBaseline(inputs: CompareInputs): Promise<ComparisonOutcome> {
  const { config, baselineDir, baselineManifest, candidateScreenshotsDir, diffDir } = inputs;
  const { repoRoot } = config;
  const threshold = config.capture.screenshot.threshold;

  const routeByName = new Map<string, string>();
  for (const descriptor of baselineManifest.routes) {
    routeByName.set(descriptor.screenshotName, descriptor.route);
  }

  const expected = new Map<string, ScreenshotFile>();
  for (const shot of baselineManifest.screenshots) {
    const name = path.posix.basename(shot.path);
    expected.set(`${shot.project}/${name}`, {
      project: shot.project,
      name,
      route: shot.route,
      absPath: path.join(baselineDir, ...shot.path.split('/')),
    });
  }

  const candidates = await listCandidateScreenshots(candidateScreenshotsDir, routeByName);

  const entries: ComparisonEntry[] = [];
  let changed = 0;
  let added = 0;
  let removed = 0;

  for (const [key, exp] of expected) {
    const base = {
      project: exp.project,
      route: exp.route,
      screenshotName: exp.name,
      expectedPath: toRepoRelative(repoRoot, exp.absPath),
    };
    const candidate = candidates.get(key);
    if (candidate === undefined) {
      removed++;
      entries.push({
        ...base,
        status: 'removed',
        actualPath: null,
        diffPath: null,
        diffPixelRatio: null,
      });
      continue;
    }

    const expectedPng = await readPng(exp.absPath, 'baseline', {
      project: exp.project,
      route: exp.route,
      path: toRepoRelative(repoRoot, exp.absPath),
    });
    const actualPng = await readPng(candidate.absPath, 'candidate', {
      project: candidate.project,
      route: exp.route,
      path: toRepoRelative(repoRoot, candidate.absPath),
    });
    const actualPath = toRepoRelative(repoRoot, candidate.absPath);
    const diffAbsPath = path.join(diffDir, exp.project, exp.name);

    if (expectedPng.width !== actualPng.width || expectedPng.height !== actualPng.height) {
      await writeDiffPng(diffAbsPath, dimensionMismatchDiff(expectedPng, actualPng, threshold));
      changed++;
      entries.push({
        ...base,
        status: 'changed',
        actualPath,
        diffPath: toRepoRelative(repoRoot, diffAbsPath),
        diffPixelRatio: 1,
      });
      continue;
    }

    const { width, height } = expectedPng;
    const diff = new PNG({ width, height });
    const differingPixels = pixelmatch(expectedPng.data, actualPng.data, diff.data, width, height, {
      threshold,
      includeAA: false,
    });
    if (differingPixels === 0) {
      entries.push({
        ...base,
        status: 'unchanged',
        actualPath,
        diffPath: null,
        diffPixelRatio: 0,
      });
      continue;
    }
    await writeDiffPng(diffAbsPath, diff);
    changed++;
    entries.push({
      ...base,
      status: 'changed',
      actualPath,
      diffPath: toRepoRelative(repoRoot, diffAbsPath),
      diffPixelRatio: differingPixels / (width * height),
    });
  }

  for (const [key, candidate] of candidates) {
    if (expected.has(key)) continue;
    added++;
    entries.push({
      project: candidate.project,
      route: candidate.route,
      screenshotName: candidate.name,
      status: 'added',
      expectedPath: null,
      actualPath: toRepoRelative(repoRoot, candidate.absPath),
      diffPath: null,
      diffPixelRatio: null,
    });
  }

  entries.sort((a, b) => {
    if (a.project !== b.project) return a.project < b.project ? -1 : 1;
    if (a.route !== b.route) return a.route < b.route ? -1 : 1;
    return 0;
  });

  return { entries, changed, added, removed };
}

let compiledValidator: ValidateFunction | null = null;

function resultValidator(): ValidateFunction {
  if (compiledValidator === null) {
    const schemaUrl = new URL('../../schemas/visual-result.schema.json', import.meta.url);
    const schema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
    compiledValidator = ajv.compile(schema);
  }
  return compiledValidator;
}

export function validateResult(value: unknown): VisualResult {
  const validate = resultValidator();
  if (!validate(value)) {
    const errors = validate.errors ?? [];
    const listed = errors
      .slice(0, MAX_LISTED_SCHEMA_ERRORS)
      .map(
        (error) =>
          `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? 'is invalid'}`,
      )
      .join('; ');
    throw new VisualRegressionError(
      'RESULT_INVALID',
      `visual-result failed schema validation: ${listed}`,
      { context: { errorCount: String(errors.length) } },
    );
  }

  const result = value as VisualResult;
  const differenceCount = result.totals.changed + result.totals.added + result.totals.removed;
  if (
    result.status === 'visual-diff' &&
    (result.operation !== 'compare' || differenceCount === 0)
  ) {
    throw new VisualRegressionError(
      'RESULT_INVALID',
      "status 'visual-diff' is only valid for a compare with changed, added, or removed screenshots",
      { context: { operation: result.operation, differences: String(differenceCount) } },
    );
  }
  if (result.status === 'pass' && result.errors.length > 0) {
    throw new VisualRegressionError('RESULT_INVALID', "status 'pass' requires zero errors", {
      context: { errorCount: String(result.errors.length) },
    });
  }
  return result;
}

export async function writeResult(resultDir: string, result: VisualResult): Promise<void> {
  const validated = validateResult(result);
  const markdown = renderMarkdownSummary(validated);
  try {
    await mkdir(resultDir, { recursive: true });
    await writeFile(
      path.join(resultDir, RESULT_JSON_NAME),
      `${JSON.stringify(validated, null, 2)}\n`,
      'utf8',
    );
    await writeFile(path.join(resultDir, RESULT_SUMMARY_NAME), markdown, 'utf8');
  } catch (cause) {
    throw new VisualRegressionError(
      'INTERNAL_ERROR',
      `Failed to write result files to ${resultDir}`,
      { context: { path: resultDir }, cause },
    );
  }
}
