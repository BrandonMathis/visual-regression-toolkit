import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { PLAYWRIGHT_CLI, PLAYWRIGHT_VERSION } from '../dist/playwright.js';

const root = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('the toolkit owns one aligned Playwright installation', () => {
  const packageJson = readJson(resolve(root, 'package.json'));
  const fixturePackageJson = readJson(resolve(root, 'tests/fixture/package.json'));

  assert.equal(packageJson.dependencies['@playwright/test'], PLAYWRIGHT_VERSION);
  assert.equal(packageJson.devDependencies?.['@playwright/test'], undefined);
  assert.equal(packageJson.dependencies.playwright, undefined);
  assert.equal(packageJson.devDependencies?.playwright, undefined);
  assert.equal(fixturePackageJson.dependencies?.['@playwright/test'], undefined);
  assert.equal(fixturePackageJson.devDependencies?.['@playwright/test'], undefined);
  assert.equal(fixturePackageJson.dependencies?.playwright, undefined);
  assert.equal(fixturePackageJson.devDependencies?.playwright, undefined);

  const lock = readJson(resolve(root, 'package-lock.json'));
  const installations = Object.entries(lock.packages).filter(([path]) =>
    /node_modules\/(?:@playwright\/test|playwright|playwright-core)$/.test(path),
  );
  const testInstallations = installations.filter(([path]) =>
    path.endsWith('node_modules/@playwright/test'),
  );

  assert.equal(testInstallations.length, 1, 'package-lock.json must install @playwright/test once');
  for (const [path, metadata] of installations) {
    assert.equal(metadata.version, PLAYWRIGHT_VERSION, `${path} is mismatched`);
  }
});

test('the runner resolves the CLI from that same toolkit dependency', () => {
  const playwrightPackage = readJson(resolve(dirname(PLAYWRIGHT_CLI), 'package.json'));
  const runnerSource = readFileSync(resolve(root, 'src/run-visual.mjs'), 'utf8');
  const fixtureToolkitRequire = createRequire(
    resolve(root, 'tests/fixture/node_modules/@thisdot/visual-regression/package.json'),
  );
  const fixturePlaywrightPackage = fixtureToolkitRequire.resolve('@playwright/test/package.json');

  assert.equal(playwrightPackage.name, '@playwright/test');
  assert.equal(playwrightPackage.version, PLAYWRIGHT_VERSION);
  assert.equal(
    realpathSync(fixturePlaywrightPackage),
    realpathSync(resolve(dirname(PLAYWRIGHT_CLI), 'package.json')),
  );
  assert.doesNotMatch(runnerSource, /\bnpx\b/);
  assert.match(runnerSource, /run\(process\.execPath, \[PLAYWRIGHT_CLI,/);
});

test('every toolkit Docker image matches the installed Playwright version', () => {
  const workflowDir = resolve(root, '.github/workflows');
  const imageVersions = readdirSync(workflowDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .flatMap((name) => {
      const workflow = readFileSync(resolve(workflowDir, name), 'utf8');
      return [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([^-]+)-noble/g)].map(
        ([, version]) => version,
      );
    });

  assert.ok(imageVersions.length > 0, 'no Playwright Docker images were found');
  assert.deepEqual([...new Set(imageVersions)], [PLAYWRIGHT_VERSION]);
});
