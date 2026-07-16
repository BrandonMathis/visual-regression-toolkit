import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ERROR_CODES, VisualRegressionError, type ErrorCode } from '../errors.js';
import type { ResolvedVisualConfig, RouteDescriptor } from '../types.js';
import { buildCapturePayload, generatePlaywrightConfig } from './generate.js';
import { generateVisualSpec } from './stabilize.js';

export interface CaptureOptions {
  config: ResolvedVisualConfig;
  routes: RouteDescriptor[];
  /** Absolute dir receiving screenshots/<project>/<screenshotName>. */
  screenshotsDir: string;
  /** ISO date injected as the logical clock (informational; env is set by the caller). */
  logicalDate: string;
  /** True for --host diagnostic runs (never authoritative). */
  host: boolean;
  /** Absolute dir for the Playwright HTML report. */
  playwrightReportDir: string;
  /** Absolute dir for Playwright test-results (traces on failure). */
  testResultsDir: string;
}

const requireFromHere = createRequire(import.meta.url);

/**
 * Generate an isolated temporary Playwright config + spec implementing the
 * plan §7 stabilization sequence for every route/project pair, then run the
 * Playwright CLI against the already-running server. Must not read, replace,
 * or merge with any consumer Playwright configuration.
 */
export async function captureRoutes(options: CaptureOptions): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'visual-regression-capture-'));
  try {
    const payload = buildCapturePayload(options);
    const reportJsonPath = join(tempDir, 'report.json');
    await writeFile(join(tempDir, 'payload.json'), JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(
      join(tempDir, 'playwright.config.mjs'),
      generatePlaywrightConfig(payload, {
        playwrightReportDir: options.playwrightReportDir,
        testResultsDir: options.testResultsDir,
        reportJsonPath,
      }),
      'utf8',
    );
    await writeFile(
      join(tempDir, 'visual.spec.mjs'),
      generateVisualSpec(playwrightTestImportUrl()),
      'utf8',
    );
    for (const project of options.config.projects) {
      await mkdir(join(options.screenshotsDir, project.name), { recursive: true });
    }
    const exitCode = await runPlaywrightCli(tempDir);
    if (exitCode !== 0) {
      throw await classifyFailure(reportJsonPath, exitCode);
    }
    await assertScreenshotsExist(options);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/** file:// URL of the toolkit's pinned @playwright/test ESM entry. */
function playwrightTestImportUrl(): string {
  const packageDir = dirname(requireFromHere.resolve('@playwright/test/package.json'));
  return pathToFileURL(join(packageDir, 'index.mjs')).href;
}

/**
 * Run the pinned Playwright CLI (resolved from the toolkit's own
 * dependencies, so the temp cwd can never resolve a different version) with
 * an explicit --config at the temp dir. Env passes through untouched,
 * including PLAYWRIGHT_BROWSERS_PATH; stderr is inherited.
 */
function runPlaywrightCli(tempDir: string): Promise<number> {
  const cliPath = requireFromHere.resolve('@playwright/test/cli');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'test', '--config', tempDir], {
      cwd: tempDir,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', (error) => {
      reject(
        new VisualRegressionError(
          'CAPTURE_FAILED',
          `failed to spawn the Playwright CLI: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.on('exit', (code, signal) => {
      if (signal !== null) {
        reject(
          new VisualRegressionError('CAPTURE_FAILED', `Playwright terminated by signal ${signal}`, {
            context: { signal },
          }),
        );
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const VR_TAG_PATTERN = /VR:([A-Z_]+) route=(\S+) project=(\S+)/;
const MAX_ERROR_SNIPPET = 500;

/**
 * Map a failed run to a stable error code: the first report.json failure
 * message carrying a VR:<CODE> tag wins; anything else is CAPTURE_FAILED
 * with a bounded snippet of the first error.
 */
async function classifyFailure(
  reportJsonPath: string,
  exitCode: number,
): Promise<VisualRegressionError> {
  let messages: string[] = [];
  try {
    const report: unknown = JSON.parse(await readFile(reportJsonPath, 'utf8'));
    messages = collectErrorMessages(report);
  } catch {
    // Missing or unreadable report: fall through to the generic failure.
  }
  for (const message of messages) {
    const match = VR_TAG_PATTERN.exec(message);
    if (match === null) {
      continue;
    }
    const [, tag, route, project] = match;
    if (tag === undefined || route === undefined || project === undefined) {
      continue;
    }
    const code: ErrorCode = (ERROR_CODES as readonly string[]).includes(tag)
      ? (tag as ErrorCode)
      : 'CAPTURE_FAILED';
    return new VisualRegressionError(code, truncate(message), { context: { route, project } });
  }
  const first = messages[0];
  return new VisualRegressionError(
    'CAPTURE_FAILED',
    first === undefined
      ? `Playwright exited with code ${exitCode} and produced no error report`
      : truncate(first),
    { context: { exitCode: String(exitCode) } },
  );
}

/** Walk the Playwright JSON report collecting every error message. */
function collectErrorMessages(node: unknown): string[] {
  const messages: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (value === null || typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    const message = record['message'];
    if (typeof message === 'string' && message.length > 0) {
      messages.push(stripAnsi(message));
    }
    for (const key of ['suites', 'specs', 'tests', 'results', 'errors', 'error']) {
      visit(record[key]);
    }
  };
  visit(node);
  return messages;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_SNIPPET ? `${message.slice(0, MAX_ERROR_SNIPPET)}…` : message;
}

/** A zero exit with a missing file still means the capture cannot be trusted. */
async function assertScreenshotsExist(options: CaptureOptions): Promise<void> {
  for (const project of options.config.projects) {
    for (const route of options.routes) {
      const screenshotPath = join(options.screenshotsDir, project.name, route.screenshotName);
      try {
        await access(screenshotPath);
      } catch {
        throw new VisualRegressionError(
          'CAPTURE_FAILED',
          `expected screenshot missing after capture: route ${route.route}, project ${project.name}`,
          { context: { route: route.route, project: project.name, path: screenshotPath } },
        );
      }
    }
  }
}
