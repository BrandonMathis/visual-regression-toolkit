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

test('workflow Docker images derive their version from package-lock.json', () => {
  const workflowDir = resolve(root, '.github/workflows');
  const resolverName = 'playwright-image.yml';
  const containerWorkflows = readdirSync(workflowDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => [name, readFileSync(resolve(workflowDir, name), 'utf8')])
    .filter(([, workflow]) => workflow.includes('container:'));
  const resolver = readFileSync(resolve(workflowDir, resolverName), 'utf8');

  assert.ok(containerWorkflows.length > 0, 'no container workflows were found');
  for (const [name, workflow] of containerWorkflows) {
    assert.doesNotMatch(
      workflow,
      /mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble/,
      `${name} must not duplicate the Playwright version`,
    );
    assert.match(workflow, /uses: \.\/\.github\/workflows\/playwright-image\.yml/);
    assert.match(workflow, /image: \$\{\{ needs\.playwright-image\.outputs\.image \}\}/);
  }
  assert.match(resolver, /path\.endsWith\('node_modules\/@playwright\/test'\)/);
  assert.match(resolver, /image=mcr\.microsoft\.com\/playwright:v\$\{version\}-noble/);
});
