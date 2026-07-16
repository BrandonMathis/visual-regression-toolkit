/**
 * Stable error codes (plan §10, §14). These are part of the workflow contract:
 * renaming or removing a code is a breaking change.
 */
export const ERROR_CODES = [
  // configuration
  'CONFIG_NOT_FOUND',
  'CONFIG_INVALID',
  // build / server lifecycle
  'BUILD_FAILED',
  'SERVER_START_FAILED',
  'SERVER_READINESS_TIMEOUT',
  // route discovery
  'PRERENDER_MANIFEST_NOT_FOUND',
  'PRERENDER_MANIFEST_UNSUPPORTED',
  'UNRESOLVED_ROUTE_PARAMETER',
  'EMPTY_ROUTE_SET',
  'SCREENSHOT_NAME_INVALID',
  'SCREENSHOT_NAME_COLLISION',
  // capture
  'NAVIGATION_FAILED',
  'READINESS_TIMEOUT',
  'FONT_CHECK_FAILED',
  'RESOURCE_BROKEN',
  'CAPTURE_FAILED',
  // baseline lifecycle
  'BASELINE_NOT_FOUND',
  'BASELINE_NOT_READY',
  'BASELINE_CORRUPT',
  'BASELINE_INCOMPATIBLE',
  'VISUAL_CONTRACT_CHANGED',
  'TOOLKIT_VERSION_MISMATCH',
  // results
  'RESULT_INVALID',
  // catch-all
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface VisualErrorOptions {
  retryable?: boolean;
  /** Small, non-secret string values only (route, project, path, timeout). */
  context?: Record<string, string>;
  cause?: unknown;
}

/**
 * All infrastructure failures raised by the toolkit are VisualRegressionError.
 * The CLI maps them to status 'infrastructure-error' / exit 1 and records the
 * code in visual-result.json. Anything else escaping to the CLI becomes
 * INTERNAL_ERROR.
 */
export class VisualRegressionError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly context: Record<string, string>;

  constructor(code: ErrorCode, message: string, options: VisualErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'VisualRegressionError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }
}

export function isVisualRegressionError(value: unknown): value is VisualRegressionError {
  return value instanceof VisualRegressionError;
}
