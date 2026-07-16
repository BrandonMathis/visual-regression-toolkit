import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';
import { VisualRegressionError } from '../../../src/errors.js';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vrt-config-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

async function writeConfig(name: string, source: string): Promise<string> {
  const filePath = path.join(repoRoot, name);
  await writeFile(filePath, source, 'utf8');
  return filePath;
}

async function expectError(
  promise: Promise<unknown>,
  code: string,
  ...fragments: string[]
): Promise<VisualRegressionError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(VisualRegressionError);
  const error = caught as VisualRegressionError;
  expect(error.code).toBe(code);
  for (const fragment of fragments) {
    expect(error.message).toContain(fragment);
  }
  return error;
}

describe('loadConfig', () => {
  it('loads a TypeScript config with TS-only syntax via jiti', async () => {
    await writeConfig(
      'visual-regression.config.ts',
      `interface Server {
        origin: string;
      }
      const server: Server = { origin: 'http://127.0.0.1:4310' };
      export default {
        framework: { type: 'next-prerender' as const },
        commands: { build: 'npm run build', start: 'npm run start' },
        server,
        capture: { masks: ['.b', '.a'] },
      };
      `,
    );
    const resolved = await loadConfig('visual-regression.config.ts', repoRoot);
    expect(resolved.server.origin).toBe('http://127.0.0.1:4310');
    expect(resolved.framework.manifestPath).toBe(
      path.join(repoRoot, '.next/prerender-manifest.json'),
    );
    expect(resolved.capture.masks).toEqual(['.a', '.b']);
    expect(resolved.configPath).toBe(path.join(repoRoot, 'visual-regression.config.ts'));
    expect(resolved.repoRoot).toBe(repoRoot);
  });

  it('loads a .mts config', async () => {
    await writeConfig(
      'visual.config.mts',
      `export default {
        framework: { type: 'next-prerender' as const },
        commands: { build: 'npm run build', start: 'npm run start' },
        server: { origin: 'http://localhost:3999' },
      };
      `,
    );
    const resolved = await loadConfig('visual.config.mts', repoRoot);
    expect(resolved.server.origin).toBe('http://localhost:3999');
  });

  it('loads a .js config written with ESM syntax', async () => {
    await writeConfig(
      'visual.config.js',
      `export default {
        framework: { type: 'next-prerender' },
        commands: { build: 'npm run build', start: 'npm run start' },
        server: { origin: 'http://127.0.0.1:3000' },
      };
      `,
    );
    const resolved = await loadConfig('visual.config.js', repoRoot);
    expect(resolved.server.origin).toBe('http://127.0.0.1:3000');
  });

  it('accepts an absolute config path', async () => {
    const filePath = await writeConfig(
      'abs.config.ts',
      `export default {
        framework: { type: 'next-prerender' },
        commands: { build: 'npm run build', start: 'npm run start' },
        server: { origin: 'http://127.0.0.1:3000' },
      };
      `,
    );
    const resolved = await loadConfig(filePath, repoRoot);
    expect(resolved.configPath).toBe(filePath);
  });

  it('throws CONFIG_NOT_FOUND for a missing file', async () => {
    const error = await expectError(
      loadConfig('missing.config.ts', repoRoot),
      'CONFIG_NOT_FOUND',
      'missing.config.ts',
    );
    expect(error.context['configPath']).toBe(path.join(repoRoot, 'missing.config.ts'));
  });

  it('throws CONFIG_INVALID with the underlying message when evaluation throws', async () => {
    await writeConfig(
      'throwing.config.ts',
      `throw new Error('boom: config exploded');
      export default {};
      `,
    );
    await expectError(
      loadConfig('throwing.config.ts', repoRoot),
      'CONFIG_INVALID',
      'boom: config exploded',
    );
  });

  it('throws CONFIG_INVALID when the default export is not a config object', async () => {
    await writeConfig('scalar.config.ts', 'export default 42;\n');
    await expectError(loadConfig('scalar.config.ts', repoRoot), 'CONFIG_INVALID');
  });

  it('throws CONFIG_INVALID when the loaded config fails validation', async () => {
    await writeConfig(
      'invalid.config.ts',
      `export default {
        framework: { type: 'next-prerender' },
        commands: { build: 'npm run build', start: 'npm run start' },
        server: { origin: 'https://example.com' },
        surprise: true,
      };
      `,
    );
    await expectError(
      loadConfig('invalid.config.ts', repoRoot),
      'CONFIG_INVALID',
      'server.origin',
      'surprise',
    );
  });
});
