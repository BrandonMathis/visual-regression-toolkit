import { describe, expect, it } from 'vitest';
import { renderMarkdownSummary } from '../../../src/reporters/index.js';
import { makeEntry, makeResult } from './helpers.js';
import type { VisualResultError } from '../../../src/types.js';

describe('renderMarkdownSummary', () => {
  it('renders a pass heading with emoji, operation, and short SHAs', () => {
    const markdown = renderMarkdownSummary(makeResult());
    expect(markdown).toContain('## ✅ Visual regression: pass');
    expect(markdown).toContain('- Operation: `compare`');
    expect(markdown).toContain(`- Candidate: \`${'b'.repeat(12)}\``);
    expect(markdown).toContain(`- Baseline: \`${'a'.repeat(12)}\``);
  });

  it('renders visual-diff and infrastructure-error headings', () => {
    const diff = makeResult({
      status: 'visual-diff',
      totals: { routes: 1, screenshots: 1, changed: 1, added: 0, removed: 0 },
      comparisons: [makeEntry({ status: 'changed', diffPixelRatio: 0.5 })],
    });
    expect(renderMarkdownSummary(diff)).toContain('## ⚠️ Visual regression: visual difference');

    const infra = makeResult({
      status: 'infrastructure-error',
      errors: [{ code: 'BUILD_FAILED', message: 'build failed', retryable: false }],
    });
    expect(renderMarkdownSummary(infra)).toContain('## ❌ Visual regression: infrastructure error');
  });

  it('omits SHA lines when unknown', () => {
    const markdown = renderMarkdownSummary(makeResult({ candidateSha: null, baseline: null }));
    expect(markdown).not.toContain('- Candidate:');
    expect(markdown).not.toContain('- Baseline:');
  });

  it('includes a totals table', () => {
    const markdown = renderMarkdownSummary(
      makeResult({
        status: 'visual-diff',
        totals: { routes: 7, screenshots: 21, changed: 3, added: 2, removed: 1 },
        comparisons: [makeEntry({ status: 'changed', diffPixelRatio: 0.5 })],
      }),
    );
    expect(markdown).toContain('| Routes | Screenshots | Changed | Added | Removed |');
    expect(markdown).toContain('| 7 | 21 | 3 | 2 | 1 |');
  });

  it('lists differences but not unchanged entries', () => {
    const markdown = renderMarkdownSummary(
      makeResult({
        status: 'visual-diff',
        totals: { routes: 2, screenshots: 2, changed: 1, added: 0, removed: 0 },
        comparisons: [
          makeEntry({ route: '/same', status: 'unchanged' }),
          makeEntry({ route: '/changed', status: 'changed', diffPixelRatio: 0.1234 }),
        ],
      }),
    );
    expect(markdown).toContain('| changed | desktop | /changed | 0.1234 |');
    expect(markdown).not.toContain('/same');
  });

  it('caps the difference table at 50 rows and notes the remainder', () => {
    const comparisons = Array.from({ length: 60 }, (_, i) =>
      makeEntry({
        route: `/page-${String(i).padStart(2, '0')}`,
        status: 'changed',
        diffPixelRatio: 0.5,
      }),
    );
    const markdown = renderMarkdownSummary(
      makeResult({
        status: 'visual-diff',
        totals: { routes: 60, screenshots: 60, changed: 60, added: 0, removed: 0 },
        comparisons,
      }),
    );
    const rows = markdown.split('\n').filter((line) => line.startsWith('| changed |'));
    expect(rows).toHaveLength(50);
    expect(markdown).toContain('_...and 10 more._');
    expect(markdown).not.toContain('/page-59');
  });

  it('escapes pipes, backticks, and angle brackets in routes', () => {
    const markdown = renderMarkdownSummary(
      makeResult({
        status: 'visual-diff',
        totals: { routes: 1, screenshots: 1, changed: 1, added: 0, removed: 0 },
        comparisons: [makeEntry({ route: '/a|b`c<d>e', status: 'changed', diffPixelRatio: 0.5 })],
      }),
    );
    expect(markdown).toContain('/a\\|b\\`c\\<d\\>e');
    expect(markdown).not.toContain('/a|b`c<d>e');
  });

  it('lists errors with code and escaped message', () => {
    const markdown = renderMarkdownSummary(
      makeResult({
        status: 'infrastructure-error',
        errors: [{ code: 'CAPTURE_FAILED', message: 'bad `route` <b>|</b>', retryable: false }],
      }),
    );
    expect(markdown).toContain('### Errors');
    expect(markdown).toContain('**CAPTURE_FAILED**: bad \\`route\\` \\<b\\>\\|\\</b\\>');
  });

  it('notes diagnostic host runs', () => {
    const host = makeResult({
      runtime: {
        toolkitVersion: '1.0.0',
        playwrightVersion: '1.61.1',
        chromiumRevision: '1228',
        os: 'darwin',
        arch: 'arm64',
        host: true,
      },
    });
    expect(renderMarkdownSummary(host)).toContain('not authoritative');
    expect(renderMarkdownSummary(makeResult())).not.toContain('not authoritative');
  });

  it('lists relative report paths, including HTML when present', () => {
    const markdown = renderMarkdownSummary(
      makeResult({
        reports: {
          html: 'playwright-report/visual/index.html',
          json: '.visual-regression/result/visual-result.json',
          markdown: '.visual-regression/result/visual-summary.md',
        },
      }),
    );
    expect(markdown).toContain('- JSON: .visual-regression/result/visual-result.json');
    expect(markdown).toContain('- Markdown: .visual-regression/result/visual-summary.md');
    expect(markdown).toContain('- HTML: playwright-report/visual/index.html');

    expect(renderMarkdownSummary(makeResult())).not.toContain('- HTML:');
  });

  it('truncates oversized output under 60000 characters with a note', () => {
    const errors: VisualResultError[] = Array.from({ length: 100 }, (_, i) => ({
      code: 'INTERNAL_ERROR',
      message: `${i} ${'x'.repeat(4900)}`,
      retryable: false,
    }));
    const markdown = renderMarkdownSummary(makeResult({ status: 'infrastructure-error', errors }));
    expect(markdown.length).toBeLessThanOrEqual(60_000);
    expect(markdown).toContain('_Summary truncated to stay within size limits._');
  });
});
