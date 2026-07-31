import { createRequire } from 'node:module';

interface PlaywrightPackage {
  version: string;
}

const require = createRequire(import.meta.url);
const playwrightPackage = require('@playwright/test/package.json') as PlaywrightPackage;

export const PLAYWRIGHT_CLI = require.resolve('@playwright/test/cli');
export const PLAYWRIGHT_VERSION = playwrightPackage.version;
export const PLAYWRIGHT_IMAGE = `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble`;
