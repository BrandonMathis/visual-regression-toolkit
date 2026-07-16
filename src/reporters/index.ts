/**
 * Human-readable reporting (plan §10). Markdown output is used both for the
 * local visual-summary.md and the GitHub job summary; it must be bounded
 * (cap listed entries, note truncation) and must escape user-controlled
 * strings (routes) for safe rendering.
 */
import type { VisualResult } from '../types.js';

export function renderMarkdownSummary(result: VisualResult): string {
  void result;
  throw new Error('not implemented');
}
