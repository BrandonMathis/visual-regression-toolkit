#!/usr/bin/env node
/**
 * Visual regression entrypoint.
 *
 * Locally: runs inside the same Playwright Linux image used by CI so Chromium
 * font rasterization matches. Host Chromium on macOS will otherwise produce
 * false typography diffs against Linux baselines.
 *
 * In CI: the workflow already uses that image, so this runs Playwright directly.
 */
import { spawnSync } from 'node:child_process';
import { PLAYWRIGHT_IMAGE } from './config.js';
const CONFIG = 'playwright.visual.config.ts';
const update = process.argv.includes('--update');
const playwrightArgs = ['playwright', 'test', '--config', CONFIG];
if (update) playwrightArgs.push('--update-snapshots');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.CI) {
  run('npm', ['run', 'build'], { shell: true });
  run('npx', playwrightArgs, { shell: true });
  process.exit(0);
}

const docker = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (docker.status !== 0) {
  console.error(
    'Docker is required for local visual tests so screenshots match CI (Linux Chromium fonts).\n' +
      'Start Docker Desktop, then re-run this command.\n' +
      'To force a host-only run (not CI-comparable): CI=1 npm run test:visual',
  );
  process.exit(1);
}

const playwrightCommand = ['npx', ...playwrightArgs].join(' ');
const inner = ['npm ci', 'npm run build', playwrightCommand].join(' && ');

run('docker', [
  'run',
  '--rm',
  '--ipc=host',
  '-v',
  `${process.cwd()}:/work`,
  '-v',
  'visual-regression-node-modules:/work/node_modules',
  '-w',
  '/work',
  PLAYWRIGHT_IMAGE,
  'bash',
  '-lc',
  inner,
]);
