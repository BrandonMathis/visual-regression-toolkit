import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureRoutes, type CaptureOptions } from '../../../src/capture/playwright.js';
import { VisualRegressionError } from '../../../src/errors.js';
import { DESKTOP, makeResolvedConfig } from './fixtures.js';

const requireFromHere = createRequire(import.meta.url);

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// A different loopback port is a different origin, so this image is blocked.
const OFF_ORIGIN_IMAGE = 'http://127.0.0.1:1/blocked.png';

const HOME_HTML = `<!doctype html>
<html><head><style>
  body { margin: 0; font-family: sans-serif; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { width: 80px; height: 80px; background: #c00; animation: spin 1s linear infinite; }
  .masked { width: 120px; height: 40px; background: #0c0; }
  .spacer { height: 2600px; background: linear-gradient(#fff, #88f); }
</style></head>
<body>
  <div class="spin"></div>
  <div class="masked">dynamic</div>
  <div class="spacer"></div>
  <img loading="lazy" src="/pixel.png" width="64" height="64" alt="lazy">
  <p>bottom</p>
</body></html>`;

const EXTERNAL_HTML = `<!doctype html>
<html><body>
  <p>page with an off-origin image</p>
  <img src="${OFF_ORIGIN_IMAGE}" width="64" height="64" alt="external">
</body></html>`;

function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HOME_HTML);
    } else if (req.url === '/external') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(EXTERNAL_HTML);
    } else if (req.url === '/pixel.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PIXEL_PNG);
    } else if (req.url === '/error') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('boom');
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function installChromium(): Promise<void> {
  const cliPath = requireFromHere.resolve('@playwright/test/cli');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`playwright install chromium exited with ${code}`));
      }
    });
  });
}

function pngSize(data: Buffer): { width: number; height: number } {
  expect(data.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe('captureRoutes (real Playwright pipeline)', () => {
  let server: Server;
  let origin: string;
  let workDir: string;

  beforeAll(async () => {
    await installChromium();
    ({ server, origin } = await startFixtureServer());
    workDir = await mkdtemp(join(tmpdir(), 'vr-capture-test-'));
  }, 600_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (workDir !== undefined) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  function makeOptions(routes: CaptureOptions['routes'], subdir: string): CaptureOptions {
    return {
      config: makeResolvedConfig({
        origin,
        projects: [DESKTOP],
        capture: { readinessSelectors: ['body'], masks: ['.masked'] },
      }),
      routes,
      screenshotsDir: join(workDir, subdir, 'screenshots'),
      logicalDate: '2026-01-01',
      host: true,
      playwrightReportDir: join(workDir, subdir, 'playwright-report'),
      testResultsDir: join(workDir, subdir, 'test-results'),
    };
  }

  it('captures a long lazy page and blocks off-origin images without false RESOURCE_BROKEN', async () => {
    const options = makeOptions(
      [
        { route: '/', screenshotName: 'home.png' },
        { route: '/external', screenshotName: 'external.png' },
      ],
      'ok',
    );
    await captureRoutes(options);

    const home = await readFile(join(options.screenshotsDir, 'desktop', 'home.png'));
    const homeSize = pngSize(home);
    expect(homeSize.width).toBe(1440);
    // Full-page capture of a page far taller than the 900px viewport.
    expect(homeSize.height).toBeGreaterThan(2000);

    const external = await readFile(join(options.screenshotsDir, 'desktop', 'external.png'));
    expect(pngSize(external).width).toBe(1440);
  }, 300_000);

  it('throws NAVIGATION_FAILED with route/project context for a 500 response', async () => {
    const options = makeOptions([{ route: '/error', screenshotName: 'error.png' }], 'fail');
    let caught: unknown;
    try {
      await captureRoutes(options);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VisualRegressionError);
    const vrError = caught as VisualRegressionError;
    expect(vrError.code).toBe('NAVIGATION_FAILED');
    expect(vrError.context['route']).toBe('/error');
    expect(vrError.context['project']).toBe('desktop');
    expect(vrError.message).toContain('status=500');
  }, 300_000);
});
