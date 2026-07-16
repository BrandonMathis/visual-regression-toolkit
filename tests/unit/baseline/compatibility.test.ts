import { describe, expect, it } from 'vitest';
import { checkBaselineCompatibility } from '../../../src/baseline/index.js';
import { VisualRegressionError } from '../../../src/errors.js';
import {
  BASELINE_MANIFEST_SCHEMA_VERSION,
  CHROMIUM_REVISION,
  PLAYWRIGHT_VERSION,
  TOOLKIT_NAME,
} from '../../../src/runtime.js';
import type { BaselineManifest, CompatibilityIdentity } from '../../../src/types.js';
import {
  TEST_CONTRACT_HASH,
  TEST_ENVIRONMENT,
  TEST_IDENTITY,
  TEST_PROJECTS,
  TEST_ROUTES,
} from './helpers.js';

function manifestFixture(): BaselineManifest {
  return {
    schemaVersion: BASELINE_MANIFEST_SCHEMA_VERSION,
    repository: TEST_IDENTITY.repository,
    baseBranch: TEST_IDENTITY.baseBranch,
    sourceSha: TEST_IDENTITY.sourceSha,
    workflowRunId: TEST_IDENTITY.workflowRunId,
    workflowRunAttempt: TEST_IDENTITY.workflowRunAttempt,
    createdAt: TEST_IDENTITY.createdAt,
    logicalDate: TEST_IDENTITY.logicalDate,
    toolkit: { name: TOOLKIT_NAME, version: '1.2.3' },
    playwrightVersion: PLAYWRIGHT_VERSION,
    chromiumRevision: CHROMIUM_REVISION,
    environment: { ...TEST_ENVIRONMENT },
    visualContractHash: TEST_CONTRACT_HASH,
    adapter: { type: 'next-prerender', behaviorVersion: 1 },
    projects: TEST_PROJECTS,
    routes: TEST_ROUTES,
    screenshots: [
      {
        project: 'desktop',
        route: '/',
        path: 'screenshots/desktop/home.png',
        width: 8,
        height: 6,
        bytes: 100,
        sha256: 'a'.repeat(64),
      },
    ],
  };
}

function matchingIdentity(): CompatibilityIdentity {
  return {
    repository: TEST_IDENTITY.repository,
    sourceSha: TEST_IDENTITY.sourceSha,
    visualContractHash: TEST_CONTRACT_HASH,
    toolkitMajor: 1,
    schemaVersion: BASELINE_MANIFEST_SCHEMA_VERSION,
    playwrightVersion: PLAYWRIGHT_VERSION,
    chromiumRevision: CHROMIUM_REVISION,
    containerDigest: TEST_ENVIRONMENT.containerDigest,
    platform: TEST_ENVIRONMENT.platform,
  };
}

function expectThrow(
  manifest: BaselineManifest,
  expected: CompatibilityIdentity,
): VisualRegressionError {
  try {
    checkBaselineCompatibility(manifest, expected);
  } catch (error) {
    expect(error).toBeInstanceOf(VisualRegressionError);
    return error as VisualRegressionError;
  }
  throw new Error('expected checkBaselineCompatibility to throw');
}

describe('checkBaselineCompatibility', () => {
  it('accepts a fully matching identity', () => {
    expect(() => checkBaselineCompatibility(manifestFixture(), matchingIdentity())).not.toThrow();
  });

  it.each<[keyof CompatibilityIdentity, string | number]>([
    ['repository', 'thisdot/other-site'],
    ['sourceSha', '1'.repeat(40)],
    ['toolkitMajor', 2],
    ['schemaVersion', 2],
    ['playwrightVersion', '1.60.0'],
    ['chromiumRevision', '9999'],
    ['containerDigest', `sha256:${'1'.repeat(64)}`],
    ['platform', 'linux/arm64'],
  ])('mismatched %s produces BASELINE_INCOMPATIBLE naming the field', (field, value) => {
    const expected = { ...matchingIdentity(), [field]: value } as CompatibilityIdentity;

    const error = expectThrow(manifestFixture(), expected);
    expect(error.code).toBe('BASELINE_INCOMPATIBLE');
    expect(error.context.mismatched).toContain(field);
    expect(error.context.mismatched).toContain(String(value));
  });

  it('parses the toolkit major from manifest.toolkit.version', () => {
    const manifest = manifestFixture();
    manifest.toolkit.version = '2.0.0';

    const error = expectThrow(manifest, matchingIdentity());
    expect(error.code).toBe('BASELINE_INCOMPATIBLE');
    expect(error.context.mismatched).toContain('toolkitMajor');
  });

  it('a contract-hash-only mismatch produces VISUAL_CONTRACT_CHANGED with rollout guidance', () => {
    const expected = { ...matchingIdentity(), visualContractHash: 'e'.repeat(64) };

    const error = expectThrow(manifestFixture(), expected);
    expect(error.code).toBe('VISUAL_CONTRACT_CHANGED');
    expect(error.message).toMatch(/explicit check waiver/);
    expect(error.message).toMatch(/default-branch baseline/);
    expect(error.message).toMatch(/resume/);
    expect(error.context.expectedVisualContractHash).toBe('e'.repeat(64));
    expect(error.context.actualVisualContractHash).toBe(TEST_CONTRACT_HASH);
  });

  it('a contract-hash mismatch combined with another mismatch is BASELINE_INCOMPATIBLE', () => {
    const expected = {
      ...matchingIdentity(),
      visualContractHash: 'e'.repeat(64),
      repository: 'thisdot/other-site',
    };

    const error = expectThrow(manifestFixture(), expected);
    expect(error.code).toBe('BASELINE_INCOMPATIBLE');
    expect(error.context.mismatched).toContain('repository');
    expect(error.context.mismatched).toContain('visualContractHash');
  });
});
