/**
 * Public package surface (plan §5.1). Keep this small: Playwright fixtures,
 * generated tests, reporters, manifest helpers, and workflow internals stay
 * private.
 */
export { defineVisualConfig } from './config/index.js';
export type { VisualRegressionConfig, VisualResult, VisualResultStatus } from './types.js';
