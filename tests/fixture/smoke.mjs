import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const fixture = import.meta.dirname;
const runner = resolve(root, 'dist/run-visual.mjs');
const cssPath = resolve(fixture, 'app/globals.css');
const originalCss = readFileSync(cssPath, 'utf8');

function run(args, expectSuccess = true) {
  const result = spawnSync(process.execPath, [runner, ...args], {
    cwd: fixture,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
  const succeeded = result.status === 0;
  if (succeeded !== expectSuccess) {
    throw new Error(`run-visual ${args.join(' ')} unexpectedly ${succeeded ? 'passed' : 'failed'}`);
  }
}

function verifyBaselines() {
  const projects = ['desktop', 'tablet', 'phone'];
  const screenshots = ['home.png', 'request-rendered.png'];

  for (const project of projects) {
    for (const screenshot of screenshots) {
      const screenshotPath = resolve(fixture, 'tests/visual/__screenshots__', project, screenshot);
      if (!existsSync(screenshotPath)) {
        throw new Error(`Baseline was not generated: ${screenshotPath}`);
      }
    }
  }
}

function removeRequestRenderedBaselines() {
  for (const project of ['desktop', 'tablet', 'phone']) {
    rmSync(resolve(fixture, 'tests/visual/__screenshots__', project, 'request-rendered.png'));
  }
}

rmSync(resolve(fixture, '.next'), { recursive: true, force: true });
rmSync(resolve(fixture, 'playwright-report'), { recursive: true, force: true });
rmSync(resolve(fixture, 'test-results'), { recursive: true, force: true });
rmSync(resolve(fixture, 'tests/visual/__screenshots__'), { recursive: true, force: true });

try {
  run(['--update']);
  verifyBaselines();

  removeRequestRenderedBaselines();
  run([]);
  verifyBaselines();

  const additions = JSON.parse(
    readFileSync(resolve(fixture, 'test-results/visual-changes.json'), 'utf8'),
  );
  const addedPage = additions.newlyAddedPages.find(({ route }) => route === '/request-rendered');
  if (
    additions.status !== 'passed' ||
    additions.changedPages.length > 0 ||
    additions.hasNonVisualFailures ||
    !addedPage ||
    addedPage.viewports.join(',') !== 'desktop,phone,tablet'
  ) {
    throw new Error('Missing baselines were not reported as newly added pages');
  }

  writeFileSync(cssPath, `${originalCss}\n.card { background: #101010; }\n`);
  rmSync(resolve(fixture, '.next'), { recursive: true, force: true });
  run([], false);

  const changes = JSON.parse(
    readFileSync(resolve(fixture, 'test-results/visual-changes.json'), 'utf8'),
  );
  if (changes.changedPages.length === 0 || changes.hasNonVisualFailures) {
    throw new Error('CSS change was not reported as a visual-only failure');
  }
} finally {
  writeFileSync(cssPath, originalCss);
}
