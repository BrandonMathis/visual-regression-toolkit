/**
 * CLI (plan §5.4, §10). Commands:
 *   visual-regression baseline create [--config <path>] [--host] [--json]
 *   visual-regression baseline verify <dir> [--json]
 *   visual-regression compare --baseline <dir> [--config <path>] [--host] [--json]
 *                             [--expect-base-sha <sha>] [--expect-repository <owner/name>]
 *   visual-regression config hash [--config <path>] [--json]
 *   visual-regression report [--json]
 *
 * Exit codes: 0 pass, 1 infrastructure-error, 2 visual-diff (compare only).
 * Logs go to stderr; stdout carries machine output when --json is set. Every
 * baseline create / compare run clears and rewrites the fixed §10 output
 * directories and writes a schema-valid visual-result.json even on failure.
 * --host warns that host screenshots are not authoritative or CI-comparable.
 */
import { Command, CommanderError } from 'commander';
import { runBaselineCreate } from './commands/baseline-create.js';
import { runBaselineVerify } from './commands/baseline-verify.js';
import { runCompare } from './commands/compare.js';
import { runConfigHash } from './commands/config-hash.js';
import { runReport } from './commands/report.js';
import { createStderrLogger } from './logger.js';

const DEFAULT_CONFIG_PATH = 'visual-regression.config.ts';

export async function runCli(argv: string[]): Promise<number> {
  const logger = createStderrLogger();
  let exitCode = 0;

  const program = new Command('visual-regression')
    .description('Shared visual regression toolkit')
    .exitOverride()
    .configureOutput({ writeErr: (str) => void process.stderr.write(str) });

  const baseline = program.command('baseline').description('Baseline artifact operations');

  baseline
    .command('create')
    .description('Build, capture, and assemble a complete verified baseline')
    .option('--config <path>', 'visual regression config file', DEFAULT_CONFIG_PATH)
    .option('--json', 'write the final VisualResult JSON to stdout')
    .option('--host', 'diagnostic host run (never authoritative or CI-comparable)')
    .action(async (opts: { config: string; json?: boolean; host?: boolean }) => {
      exitCode = await runBaselineCreate(
        { configPath: opts.config, json: opts.json === true, host: opts.host === true },
        logger,
      );
    });

  baseline
    .command('verify')
    .description('Verify a baseline directory: manifest, checksums, and completeness')
    .argument('<dir>', 'baseline directory')
    .option('--json', 'write the verification summary as JSON to stdout')
    .action(async (dir: string, opts: { json?: boolean }) => {
      exitCode = await runBaselineVerify({ dir, json: opts.json === true }, logger);
    });

  program
    .command('compare')
    .description('Capture a candidate and compare it against a verified baseline')
    .requiredOption('--baseline <dir>', 'verified baseline directory')
    .option('--config <path>', 'visual regression config file', DEFAULT_CONFIG_PATH)
    .option('--json', 'write the final VisualResult JSON to stdout')
    .option('--host', 'diagnostic host run (never authoritative or CI-comparable)')
    .option('--expect-base-sha <sha>', 'full commit SHA the baseline must have been created from')
    .option('--expect-repository <owner/name>', 'repository the baseline must belong to')
    .action(
      async (opts: {
        baseline: string;
        config: string;
        json?: boolean;
        host?: boolean;
        expectBaseSha?: string;
        expectRepository?: string;
      }) => {
        exitCode = await runCompare(
          {
            configPath: opts.config,
            baselineDir: opts.baseline,
            json: opts.json === true,
            host: opts.host === true,
            expectBaseSha: opts.expectBaseSha,
            expectRepository: opts.expectRepository,
          },
          logger,
        );
      },
    );

  const config = program.command('config').description('Configuration utilities');

  config
    .command('hash')
    .description('Print the normalized visual-contract hash')
    .option('--config <path>', 'visual regression config file', DEFAULT_CONFIG_PATH)
    .option('--json', 'write {"visualContractHash": ...} to stdout')
    .action(async (opts: { config: string; json?: boolean }) => {
      exitCode = await runConfigHash({ configPath: opts.config, json: opts.json === true }, logger);
    });

  program
    .command('report')
    .description('Print the location of the latest Playwright HTML report')
    .option('--json', 'write {"reportPath": ...} to stdout')
    .action(async (opts: { json?: boolean }) => {
      exitCode = await runReport({ json: opts.json === true }, logger);
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 1;
    }
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return exitCode;
}
