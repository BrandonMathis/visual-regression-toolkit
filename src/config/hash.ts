import { createHash } from 'node:crypto';
import { ADAPTER_BEHAVIOR_VERSION, STABILIZATION_BEHAVIOR_VERSION } from '../runtime.js';
import type { ResolvedVisualConfig } from '../types.js';

/**
 * Visual-contract hash (plan §5.3).
 *
 * INCLUDED — every setting that can alter rendered pixels or comparison
 * semantics, so any change invalidates existing baselines:
 * - adapter type plus ADAPTER_BEHAVIOR_VERSION (route selection semantics);
 * - projects sorted by name (viewport and device capabilities);
 * - capture settings: colorScheme, locale, timezoneId, reducedMotion,
 *   fontChecks, readinessSelectors, masks, externalRequests, screenshot;
 * - STABILIZATION_BEHAVIOR_VERSION (page stabilization semantics).
 *
 * EXCLUDED — values that locate or identify a run without changing how a
 * given page renders:
 * - routes config (include/exclude/additional): added or removed pages must
 *   surface as visual differences, not contract changes;
 * - commands and server settings (how the app is built and served);
 * - framework.manifestPath, repoRoot, configPath (filesystem layout);
 * - clock env var name (the logical date value comes from the baseline);
 * - source SHAs, timestamps, and output/report locations.
 */
export function computeVisualContractHash(config: ResolvedVisualConfig): string {
  const contract = {
    adapter: { type: config.framework.type, behaviorVersion: ADAPTER_BEHAVIOR_VERSION },
    stabilizationBehaviorVersion: STABILIZATION_BEHAVIOR_VERSION,
    projects: [...config.projects].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    capture: config.capture,
  };
  return createHash('sha256').update(canonicalJson(contract)).digest('hex');
}

/** JSON with recursively sorted object keys so equivalent objects hash identically. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(',')}}`;
}
