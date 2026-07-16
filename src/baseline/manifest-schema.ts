import { readFileSync } from 'node:fs';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { BaselineManifest } from '../types.js';

const schemaUrl = new URL('../../schemas/baseline-manifest.schema.json', import.meta.url);

const ajv = new Ajv({ allErrors: true });

/** Compiled once at module scope; validates a parsed baseline-manifest.json document. */
export const validateManifest: ValidateFunction<BaselineManifest> = ajv.compile<BaselineManifest>(
  JSON.parse(readFileSync(schemaUrl, 'utf8')) as Record<string, unknown>,
);

/** Bounded summary of the first few ajv error paths for BASELINE_CORRUPT context. */
export function describeSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  const first = (errors ?? []).slice(0, 3);
  if (first.length === 0) {
    return 'unknown schema violation';
  }
  return first
    .map(
      (error) =>
        `${error.instancePath === '' ? '/' : error.instancePath}: ${error.message ?? 'invalid'}`,
    )
    .join('; ');
}
