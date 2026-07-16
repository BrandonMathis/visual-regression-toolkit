import { access } from 'node:fs/promises';
import path from 'node:path';
import { PLAYWRIGHT_REPORT_DIR } from '../../paths.js';
import type { Logger } from '../logger.js';
import { emitJson } from '../shared.js';

export interface ReportOptions {
  json: boolean;
}

export async function runReport(options: ReportOptions, logger: Logger): Promise<number> {
  const repoRoot = process.cwd();
  const htmlPath = path.resolve(repoRoot, PLAYWRIGHT_REPORT_DIR, 'index.html');
  try {
    await access(htmlPath);
  } catch {
    logger.error(
      `No Playwright HTML report found at ${htmlPath}. Run 'baseline create' or 'compare' first.`,
    );
    return 1;
  }
  if (options.json) {
    emitJson({ reportPath: htmlPath });
  } else {
    process.stdout.write(`${htmlPath}\n`);
  }
  // v1 never auto-opens the report (plan §5.4).
  logger.info(`Open it in a browser, e.g.: open '${htmlPath}'`);
  return 0;
}
