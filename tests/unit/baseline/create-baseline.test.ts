import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import { createBaseline, verifyBaseline } from '../../../src/baseline/index.js';
import { MANIFEST_NAME } from '../../../src/paths.js';
import {
  ADAPTER_BEHAVIOR_VERSION,
  BASELINE_MANIFEST_SCHEMA_VERSION,
  CHROMIUM_REVISION,
  PLAYWRIGHT_VERSION,
  TOOLKIT_NAME,
  toolkitVersion,
} from '../../../src/runtime.js';
import {
  PNG_HEIGHT,
  PNG_WIDTH,
  TEST_CONTRACT_HASH,
  TEST_ENVIRONMENT,
  TEST_IDENTITY,
  TEST_PROJECTS,
  TEST_ROUTES,
  cleanupFixtures,
  expectVisualError,
  makeBaselineFixture,
} from './helpers.js';

afterEach(cleanupFixtures);

describe('createBaseline', () => {
  it('creates a baseline that round-trips through verifyBaseline', async () => {
    const { baselineDir, options } = await makeBaselineFixture();
    const manifest = await createBaseline(options);

    expect(manifest.schemaVersion).toBe(BASELINE_MANIFEST_SCHEMA_VERSION);
    expect(manifest.toolkit).toEqual({ name: TOOLKIT_NAME, version: toolkitVersion() });
    expect(manifest.playwrightVersion).toBe(PLAYWRIGHT_VERSION);
    expect(manifest.chromiumRevision).toBe(CHROMIUM_REVISION);
    expect(manifest.adapter).toEqual({
      type: 'next-prerender',
      behaviorVersion: ADAPTER_BEHAVIOR_VERSION,
    });
    expect(manifest.repository).toBe(TEST_IDENTITY.repository);
    expect(manifest.baseBranch).toBe(TEST_IDENTITY.baseBranch);
    expect(manifest.sourceSha).toBe(TEST_IDENTITY.sourceSha);
    expect(manifest.workflowRunId).toBe(TEST_IDENTITY.workflowRunId);
    expect(manifest.workflowRunAttempt).toBe(TEST_IDENTITY.workflowRunAttempt);
    expect(manifest.createdAt).toBe(TEST_IDENTITY.createdAt);
    expect(manifest.logicalDate).toBe(TEST_IDENTITY.logicalDate);
    expect(manifest.environment).toEqual(TEST_ENVIRONMENT);
    expect(manifest.visualContractHash).toBe(TEST_CONTRACT_HASH);
    expect(manifest.routes).toEqual(TEST_ROUTES);
    expect(manifest.projects).toEqual(TEST_PROJECTS);

    const verified = await verifyBaseline(baselineDir);
    expect(verified).toEqual(manifest);
  });

  it('sorts screenshots by (project, path) and records real file facts', async () => {
    const { baselineDir, options } = await makeBaselineFixture();
    const manifest = await createBaseline(options);

    expect(manifest.screenshots.map((entry) => `${entry.project} ${entry.path}`)).toEqual([
      'desktop screenshots/desktop/about.png',
      'desktop screenshots/desktop/home.png',
      'phone screenshots/phone/about.png',
      'phone screenshots/phone/home.png',
    ]);

    for (const entry of manifest.screenshots) {
      const data = await readFile(join(baselineDir, entry.path));
      expect(entry.bytes).toBe(data.length);
      expect(entry.sha256).toBe(createHash('sha256').update(data).digest('hex'));
      expect(entry.width).toBe(PNG_WIDTH);
      expect(entry.height).toBe(PNG_HEIGHT);
    }
  });

  it('writes the manifest with 2-space indentation and a trailing newline', async () => {
    const { baselineDir, options } = await makeBaselineFixture();
    const manifest = await createBaseline(options);

    const raw = await readFile(join(baselineDir, MANIFEST_NAME), 'utf8');
    expect(raw.startsWith('{\n  "schemaVersion"')).toBe(true);
    expect(raw.endsWith('}\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual(manifest);
  });

  it('produces a manifest that satisfies the published JSON schema', async () => {
    const { options } = await makeBaselineFixture();
    const manifest = await createBaseline(options);

    const schema = JSON.parse(
      readFileSync(
        new URL('../../../schemas/baseline-manifest.schema.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const validate = new Ajv({ allErrors: true }).compile(schema);
    expect(validate(JSON.parse(JSON.stringify(manifest)))).toBe(true);
  });

  it('rejects with CAPTURE_FAILED naming the pair when a screenshot is missing', async () => {
    const { screenshotsDir, baselineDir, options } = await makeBaselineFixture();
    await rm(join(screenshotsDir, 'phone', 'about.png'));

    const error = await expectVisualError(createBaseline(options), 'CAPTURE_FAILED');
    expect(error.context.route).toBe('/about');
    expect(error.context.project).toBe('phone');
    expect(error.message).toContain('/about');
    expect(error.message).toContain('phone');
    expect(existsSync(join(baselineDir, MANIFEST_NAME))).toBe(false);
  });

  it('rejects with CAPTURE_FAILED when a captured file is not a valid PNG', async () => {
    const { screenshotsDir, baselineDir, options } = await makeBaselineFixture();
    const target = join(screenshotsDir, 'desktop', 'home.png');
    await writeFile(target, Buffer.from('this is not a png'));

    const error = await expectVisualError(createBaseline(options), 'CAPTURE_FAILED');
    expect(error.context.route).toBe('/');
    expect(error.context.project).toBe('desktop');
    expect(existsSync(join(baselineDir, MANIFEST_NAME))).toBe(false);
  });
});
