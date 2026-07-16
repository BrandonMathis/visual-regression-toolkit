/**
 * Human-readable reporting (plan §10). Markdown output is used both for the
 * local visual-summary.md and the GitHub job summary; it must be bounded
 * (cap listed entries, note truncation) and must escape user-controlled
 * strings (routes) for safe rendering.
 */
import type { VisualResult, VisualResultStatus } from '../types.js';

/** Keep well below GitHub's 1 MiB job-summary limit. */
const MAX_SUMMARY_CHARS = 60_000;
const MAX_TABLE_ROWS = 50;
const TRUNCATION_NOTE = '\n\n_Summary truncated to stay within size limits._\n';

const STATUS_EMOJI: Record<VisualResultStatus, string> = {
  pass: '✅',
  'visual-diff': '⚠️',
  'infrastructure-error': '❌',
};

const STATUS_LABEL: Record<VisualResultStatus, string> = {
  pass: 'pass',
  'visual-diff': 'visual difference',
  'infrastructure-error': 'infrastructure error',
};

/** Escapes pipes, backticks, and angle brackets in user-controlled strings. */
function escapeMarkdown(text: string): string {
  return text.replace(/[|`<>]/g, (char) => `\\${char}`);
}

function formatRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  return ratio.toFixed(4);
}

export function renderMarkdownSummary(result: VisualResult): string {
  const lines: string[] = [];

  lines.push(`## ${STATUS_EMOJI[result.status]} Visual regression: ${STATUS_LABEL[result.status]}`);
  lines.push('');
  lines.push(`- Operation: \`${result.operation}\``);
  if (result.candidateSha !== null) {
    lines.push(`- Candidate: \`${result.candidateSha.slice(0, 12)}\``);
  }
  if (result.baseline !== null) {
    lines.push(`- Baseline: \`${result.baseline.sourceSha.slice(0, 12)}\``);
  }
  lines.push('');

  if (result.runtime.host) {
    lines.push(
      '> ⚠️ Diagnostic host run: these screenshots are not authoritative and are not comparable to CI baselines.',
    );
    lines.push('');
  }

  lines.push('### Totals');
  lines.push('');
  lines.push('| Routes | Screenshots | Changed | Added | Removed |');
  lines.push('| ---: | ---: | ---: | ---: | ---: |');
  const { routes, screenshots, changed, added, removed } = result.totals;
  lines.push(`| ${routes} | ${screenshots} | ${changed} | ${added} | ${removed} |`);
  lines.push('');

  const differences = result.comparisons.filter((entry) => entry.status !== 'unchanged');
  if (differences.length > 0) {
    lines.push('### Changed, added, and removed screenshots');
    lines.push('');
    lines.push('| Status | Project | Route | Diff pixel ratio |');
    lines.push('| --- | --- | --- | ---: |');
    for (const entry of differences.slice(0, MAX_TABLE_ROWS)) {
      lines.push(
        `| ${entry.status} | ${escapeMarkdown(entry.project)} | ${escapeMarkdown(entry.route)} | ${formatRatio(entry.diffPixelRatio)} |`,
      );
    }
    if (differences.length > MAX_TABLE_ROWS) {
      lines.push('');
      lines.push(`_...and ${differences.length - MAX_TABLE_ROWS} more._`);
    }
    lines.push('');
  }

  if (result.errors.length > 0) {
    lines.push('### Errors');
    lines.push('');
    for (const error of result.errors) {
      lines.push(`- **${escapeMarkdown(error.code)}**: ${escapeMarkdown(error.message)}`);
    }
    lines.push('');
  }

  lines.push('### Reports');
  lines.push('');
  lines.push(`- JSON: ${escapeMarkdown(result.reports.json)}`);
  lines.push(`- Markdown: ${escapeMarkdown(result.reports.markdown)}`);
  if (result.reports.html !== null) {
    lines.push(`- HTML: ${escapeMarkdown(result.reports.html)}`);
  }
  lines.push('');

  const rendered = lines.join('\n');
  if (rendered.length <= MAX_SUMMARY_CHARS) return rendered;
  return rendered.slice(0, MAX_SUMMARY_CHARS - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}
