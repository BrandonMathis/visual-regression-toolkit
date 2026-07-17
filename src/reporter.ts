import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

const resultsDir = resolve(process.cwd(), 'test-results');
const summaryPath = resolve(resultsDir, 'visual-summary.md');
const changesPath = resolve(resultsDir, 'visual-changes.json');

interface ChangedPage {
  route: string;
  viewports: string[];
}

function isScreenshotError(error: { message?: string; stack?: string }) {
  return `${error.message ?? ''}\n${error.stack ?? ''}`.includes('toHaveScreenshot');
}

function isScreenshotFailure(test: TestCase) {
  return test.results.some((result) => result.errors.some(isScreenshotError));
}

function hasNonVisualFailure(test: TestCase) {
  return (
    !isScreenshotFailure(test) ||
    test.results.some((result) => result.errors.some((error) => !isScreenshotError(error)))
  );
}

function collectChangedPages(finalFailures: TestCase[]): ChangedPage[] {
  const changedPages = new Map<string, Set<string>>();

  for (const test of finalFailures.filter(isScreenshotFailure)) {
    const viewport = test.parent.project()?.name ?? 'unknown viewport';
    const viewports = changedPages.get(test.title) ?? new Set<string>();
    viewports.add(viewport);
    changedPages.set(test.title, viewports);
  }

  return [...changedPages]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, viewports]) => ({
      route,
      viewports: [...viewports].sort(),
    }));
}

function buildSummary(result: FullResult, changedPages: ChangedPage[], finalFailures: TestCase[]) {
  const lines = [`**Visual check:** ${result.status}`];

  if (changedPages.length > 0) {
    lines.push(
      '',
      '### Pages recommended for manual testing',
      '',
      'Visual differences were detected on these route and viewport combinations:',
    );

    for (const page of changedPages) {
      lines.push(`- [ ] \`${page.route}\` — ${page.viewports.join(', ')}`);
    }

    lines.push(
      '',
      'Test these pages at the listed viewport sizes before approving the visual changes.',
      '',
      '_PR comments include Amplify preview links for each page._',
    );
  } else if (finalFailures.length > 0 || result.status !== 'passed') {
    lines.push(
      '',
      'No completed visual differences were identified. The test run failed for another reason; inspect the workflow logs.',
    );
  } else {
    lines.push('', '✅ No pages need additional visual testing.');
  }

  return `${lines.join('\n')}\n`;
}

class VisualSummaryReporter implements Reporter {
  private tests: TestCase[] = [];

  onBegin(_config: unknown, suite: Suite) {
    this.tests = suite.allTests();
  }

  onEnd(result: FullResult) {
    const finalFailures = this.tests.filter((test) => !test.ok());
    const changedPages = collectChangedPages(finalFailures);
    const hasNonVisualFailures = finalFailures.some(hasNonVisualFailure);

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      changesPath,
      `${JSON.stringify(
        {
          status: result.status,
          changedPages,
          hasNonVisualFailures,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(summaryPath, buildSummary(result, changedPages, finalFailures));
  }
}

export default VisualSummaryReporter;
