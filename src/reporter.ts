import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

const resultsDir = resolve(process.cwd(), 'test-results');
const summaryPath = resolve(resultsDir, 'visual-summary.md');
const changesPath = resolve(resultsDir, 'visual-changes.json');
const newPageAnnotation = 'visual-regression-new-page';

interface ChangedPage {
  route: string;
  viewports: string[];
}

function isScreenshotError(error: { message?: string; stack?: string }) {
  return `${error.message ?? ''}\n${error.stack ?? ''}`.includes('toHaveScreenshot');
}

function isNewPage(test: TestCase) {
  return test.annotations.some(({ type }) => type === newPageAnnotation);
}

function hasNonVisualFailure(test: TestCase) {
  return (
    !test.results.some((result) => result.errors.some(isScreenshotError)) ||
    test.results.some((result) => result.errors.some((error) => !isScreenshotError(error)))
  );
}

function collectPages(tests: TestCase[], predicate: (test: TestCase) => boolean): ChangedPage[] {
  const pages = new Map<string, Set<string>>();

  for (const test of tests.filter(predicate)) {
    const viewport = test.parent.project()?.name ?? 'unknown viewport';
    const viewports = pages.get(test.title) ?? new Set<string>();
    viewports.add(viewport);
    pages.set(test.title, viewports);
  }

  return [...pages]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, viewports]) => ({
      route,
      viewports: [...viewports].sort(),
    }));
}

function appendPages(lines: string[], pages: ChangedPage[]) {
  for (const page of pages) {
    lines.push(`- [ ] \`${page.route}\` — ${page.viewports.join(', ')}`);
  }
}

function buildSummary(
  status: FullResult['status'],
  newlyAddedPages: ChangedPage[],
  changedPages: ChangedPage[],
  finalFailures: TestCase[],
) {
  const lines = [`**Visual check:** ${status}`];

  if (newlyAddedPages.length > 0) {
    lines.push(
      '',
      '### Newly added pages',
      '',
      'No baseline screenshots existed for these route and viewport combinations:',
    );
    appendPages(lines, newlyAddedPages);
    lines.push('', 'Their generated screenshots should be manually reviewed.');
  }

  if (changedPages.length > 0) {
    lines.push(
      '',
      '### Pages recommended for manual testing',
      '',
      'Visual differences were detected on these route and viewport combinations:',
    );
    appendPages(lines, changedPages);
    lines.push('', 'Test these pages before approving the visual changes.');
  }

  if (newlyAddedPages.length > 0 || changedPages.length > 0) {
    lines.push('', '_PR comments include Amplify preview links for each page._');
  } else if (finalFailures.length > 0 || status !== 'passed') {
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
  private hasGlobalErrors = false;

  onBegin(_config: unknown, suite: Suite) {
    this.tests = suite.allTests();
  }

  onError() {
    this.hasGlobalErrors = true;
  }

  onEnd(result: FullResult) {
    const finalFailures = this.tests.filter((test) => !test.ok());
    const newlyAddedPages = collectPages(this.tests, isNewPage);
    const changedPages = collectPages(finalFailures, (test) =>
      test.results.some((testResult) => testResult.errors.some(isScreenshotError)),
    );
    const hasNonVisualFailures = this.hasGlobalErrors || finalFailures.some(hasNonVisualFailure);

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      changesPath,
      `${JSON.stringify(
        {
          status: result.status,
          newlyAddedPages,
          changedPages,
          hasNonVisualFailures,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      summaryPath,
      buildSummary(result.status, newlyAddedPages, changedPages, finalFailures),
    );
  }
}

export default VisualSummaryReporter;
