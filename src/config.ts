import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

export interface VisualConfigOptions {
  fonts?: string[];
  colorScheme?: 'dark' | 'light' | 'no-preference' | null;
  port?: number;
  startCommand?: string;
  exclude?: string[];
}

export const PLAYWRIGHT_VERSION = '1.61.1';
export const PLAYWRIGHT_IMAGE = `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble`;

const sourceDir = dirname(fileURLToPath(import.meta.url));

export function createVisualConfig(options: VisualConfigOptions = {}): PlaywrightTestConfig {
  const resolvedOptions = {
    fonts: options.fonts ?? [],
    colorScheme: options.colorScheme ?? 'dark',
    port: options.port ?? 3000,
    startCommand: options.startCommand ?? 'npm run start -- --hostname 127.0.0.1',
    exclude: options.exclude ?? [],
  };
  const baseURL = `http://127.0.0.1:${resolvedOptions.port}`;

  process.env.VISUAL_TOOLKIT_OPTIONS = JSON.stringify(resolvedOptions);

  return defineConfig({
    testDir: sourceDir,
    testMatch: 'pages.spec.js',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    workers: process.env.CI ? 2 : '50%',
    outputDir: resolve(process.cwd(), 'test-results'),
    reporter: [
      ['list'],
      ['html', { outputFolder: resolve(process.cwd(), 'playwright-report'), open: 'never' }],
      [resolve(sourceDir, 'reporter.js')],
    ],
    snapshotPathTemplate: resolve(
      process.cwd(),
      'tests/visual/__screenshots__/{projectName}/{arg}{ext}',
    ),
    use: {
      baseURL,
      browserName: 'chromium',
      colorScheme: resolvedOptions.colorScheme,
      contextOptions: {
        reducedMotion: 'reduce',
      },
      locale: 'en-US',
      screenshot: 'only-on-failure',
      serviceWorkers: 'block',
      trace: 'retain-on-failure',
    },
    expect: {
      timeout: 15_000,
      toHaveScreenshot: {
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        threshold: 0.2,
      },
    },
    projects: [
      {
        name: 'desktop',
        use: {
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
        },
      },
      {
        name: 'tablet',
        use: {
          viewport: { width: 768, height: 1024 },
          deviceScaleFactor: 1,
          hasTouch: true,
        },
      },
      {
        name: 'phone',
        use: {
          viewport: { width: 375, height: 812 },
          deviceScaleFactor: 1,
          hasTouch: true,
          isMobile: true,
        },
      },
    ],
    webServer: {
      command: resolvedOptions.startCommand,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  });
}
