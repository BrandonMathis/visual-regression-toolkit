export const ErrorCodes = {
  CONFIG_INVALID: "CONFIG_INVALID",
  BUILD_FAILED: "BUILD_FAILED",
  SERVER_FAILED: "SERVER_FAILED",
  SERVER_TIMEOUT: "SERVER_TIMEOUT",
  ROUTE_DISCOVERY_FAILED: "ROUTE_DISCOVERY_FAILED",
  CAPTURE_FAILED: "CAPTURE_FAILED",
  BASELINE_NOT_FOUND: "BASELINE_NOT_FOUND",
  BASELINE_NOT_READY: "BASELINE_NOT_READY",
  BASELINE_EXPIRED: "BASELINE_EXPIRED",
  BASELINE_ARTIFACT_UNAVAILABLE: "BASELINE_ARTIFACT_UNAVAILABLE",
  BASELINE_API_ERROR: "BASELINE_API_ERROR",
  BASELINE_CORRUPT: "BASELINE_CORRUPT",
  BASELINE_INCOMPATIBLE: "BASELINE_INCOMPATIBLE",
  VISUAL_CONTRACT_CHANGED: "VISUAL_CONTRACT_CHANGED",
  RESULT_INVALID: "RESULT_INVALID",
  RESULT_IDENTITY_MISMATCH: "RESULT_IDENTITY_MISMATCH",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
export class VisualRegressionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message.slice(0, 2048));
    this.name = "VisualRegressionError";
  }
}
export function asVisualError(
  error: unknown,
  fallback = ErrorCodes.INTERNAL_ERROR,
): VisualRegressionError {
  if (error instanceof VisualRegressionError) return error;
  return new VisualRegressionError(
    fallback,
    error instanceof Error ? error.message : "Unknown error",
  );
}
