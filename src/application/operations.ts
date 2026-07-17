import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type {
  NormalizedConfig,
  ReleaseIdentity,
  VisualResult,
} from "../contracts/types.js";
import { readConfig } from "../config/index.js";
import { buildAndStart } from "./build-and-start.js";
import { discoverRoutes } from "../discovery/index.js";
import { runCaptureSuite } from "../capture/run-suite.js";
import { createManifest } from "../baseline/create-manifest.js";
import { verifyBaseline } from "../baseline/verify.js";
import { compareCaptures } from "../compare/run-comparison.js";
import { completedResult } from "../result/builder.js";
import { ensureSafeDirectory } from "../platform/paths.js";

export type ExecutionIdentity = {
  consumerRepository: string;
  baseBranch: string;
  sourceSha: string;
  baseSha: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  logicalDate: string;
  release: ReleaseIdentity;
};
async function capture(
  root: string,
  config: NormalizedConfig,
  logicalDate: string,
  output: string,
) {
  const server = await buildAndStart(root, config, logicalDate);
  const shutdown = (signal: NodeJS.Signals): void => {
    void server.stop().finally(() => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.kill(process.pid, signal);
    });
  };
  const interrupt = (): void => {
    shutdown("SIGINT");
  };
  const terminate = (): void => {
    shutdown("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    const routes = await discoverRoutes(root, config);
    return {
      routes,
      records: await runCaptureSuite(root, config, routes, output, logicalDate),
    };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    await server.stop();
  }
}
export async function createBaseline(
  root: string,
  configPath: string,
  identity: ExecutionIdentity,
): Promise<VisualResult> {
  const { config, hash } = await readConfig(root, configPath);
  const generated = await ensureSafeDirectory(root, ".visual-regression");
  const staging = path.join(generated, "baseline.staging");
  const destination = path.join(generated, "baseline");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const { routes, records } = await capture(
      root,
      config,
      identity.logicalDate,
      staging,
    );
    await createManifest(staging, {
      consumerRepository: identity.consumerRepository,
      baseBranch: identity.baseBranch,
      sourceSha: identity.sourceSha,
      workflowRunId: identity.workflowRunId,
      workflowRunAttempt: identity.workflowRunAttempt,
      createdAt: new Date().toISOString(),
      logicalDate: identity.logicalDate,
      release: identity.release,
      visualContractHash: hash,
      projects: config.projects,
      routes,
      records,
    });
    await verifyBaseline(staging);
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return completedResult({
      operation: "baseline-create",
      status: "pass",
      candidateSha: identity.sourceSha,
      visualContractHash: hash,
      runtime: identity.release,
      routeTotal: routes.length,
      screenshotTotal: records.length,
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
export async function compareBaseline(
  root: string,
  configPath: string,
  baselineRoot: string,
  identity: ExecutionIdentity,
): Promise<VisualResult> {
  const { config, hash } = await readConfig(root, configPath);
  const generated = await ensureSafeDirectory(root, ".visual-regression");
  const output = path.join(generated, "candidate");
  const resultRoot = path.join(generated, "result");
  const baselineOutput = path.join(generated, "baseline");
  const baselineInput = path.resolve(baselineRoot);
  const baselineIsOutput = baselineInput === baselineOutput;
  for (const unsafe of [output, resultRoot]) {
    if (
      baselineInput === unsafe ||
      baselineInput.startsWith(`${unsafe}${path.sep}`) ||
      unsafe.startsWith(`${baselineInput}${path.sep}`)
    )
      throw new Error("Baseline input overlaps generated output");
  }
  if (
    !baselineIsOutput &&
    (baselineInput.startsWith(`${baselineOutput}${path.sep}`) ||
      baselineOutput.startsWith(`${baselineInput}${path.sep}`))
  )
    throw new Error("Baseline input overlaps generated baseline output");
  const verified = await verifyBaseline(baselineInput, {
    consumerRepository: identity.consumerRepository,
    sourceSha: identity.baseSha,
    visualContractHash: hash,
    release: identity.release,
  });
  await rm(output, { recursive: true, force: true });
  await rm(resultRoot, { recursive: true, force: true });
  if (!baselineIsOutput) {
    await rm(baselineOutput, { recursive: true, force: true });
    await cp(baselineInput, baselineOutput, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
  await verifyBaseline(baselineOutput, {
    consumerRepository: identity.consumerRepository,
    sourceSha: identity.baseSha,
    visualContractHash: hash,
    release: identity.release,
  });
  await mkdir(output, { recursive: true });
  const { routes, records } = await capture(
    root,
    config,
    verified.manifest.logicalDate,
    output,
  );
  const fresh = await verifyBaseline(baselineOutput, {
    consumerRepository: identity.consumerRepository,
    sourceSha: identity.baseSha,
    visualContractHash: hash,
    release: identity.release,
  });
  const differences = await compareCaptures(
    fresh,
    records,
    resultRoot,
    config.capture.screenshot.threshold,
  );
  const status =
    differences.changed.length ||
    differences.added.length ||
    differences.removed.length
      ? "visual-diff"
      : "pass";
  return completedResult({
    operation: "compare",
    status,
    candidateSha: identity.sourceSha,
    baselineSha: fresh.manifest.sourceSha,
    visualContractHash: hash,
    runtime: identity.release,
    routeTotal: routes.length,
    screenshotTotal: records.length,
    ...differences,
  });
}
