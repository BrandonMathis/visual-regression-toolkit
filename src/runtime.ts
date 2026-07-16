import { readFileSync } from 'node:fs';

/**
 * Release-coupled runtime identity (plan §3, §12). One toolkit release binds
 * all of these together; changing any pixel-affecting value requires a new
 * toolkit release and new consumer baselines.
 */

export const TOOLKIT_NAME = '@thisdot/visual-regression';

export const PLAYWRIGHT_VERSION = '1.61.1';
export const CHROMIUM_REVISION = '1228';
export const CHROMIUM_VERSION = '149.0.7827.55';

export const CONTAINER_IMAGE = 'mcr.microsoft.com/playwright:v1.61.1-noble';
export const CONTAINER_DIGEST =
  'sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48';
export const CONTAINER_PLATFORM = 'linux/amd64';

export const NODE_MAJOR = 22;

export const BASELINE_MANIFEST_SCHEMA_VERSION = 1;
export const VISUAL_RESULT_SCHEMA_VERSION = 1;

/** Bump when page-stabilization behavior changes in a pixel-affecting way. */
export const STABILIZATION_BEHAVIOR_VERSION = 1;
/** Bump when next-prerender route discovery behavior changes. */
export const ADAPTER_BEHAVIOR_VERSION = 1;

let cachedVersion: string | null = null;

/** Exact toolkit package version, read from the package's own package.json. */
export function toolkitVersion(): string {
  if (cachedVersion === null) {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    cachedVersion = (JSON.parse(raw) as { version: string }).version;
  }
  return cachedVersion;
}

export function toolkitMajor(): number {
  return Number.parseInt(toolkitVersion().split('.')[0] ?? '0', 10);
}

export function hostEnvironment(): { os: string; arch: string } {
  return { os: process.platform, arch: process.arch };
}
