import { mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { verifyBaseline } from "../baseline/verify.js";
import { VisualRegressionError } from "../contracts/error-codes.js";
import type { BaselineManifest, ReleaseIdentity } from "../contracts/types.js";
import { releaseIdentity } from "../platform/release.js";
import { ARCHIVE_LIMITS, extractArtifactZip } from "./archive.js";

export type Run = {
  id: string;
  run_attempt: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  path: string;
  repository: { id: string | number; full_name: string };
};
type Artifact = {
  id: string;
  name: string;
  expired: boolean;
  size_in_bytes: number;
  archive_download_url: string;
  workflow_run?: { id: string | number; head_sha?: string };
};
type ResolveOptions = {
  repository: string;
  repositoryId: string;
  baseSha: string;
  contractHash: string;
  baseBranch: string;
  workflowFile: string;
  output: string;
  token: string;
  waitSeconds?: number;
};
export type ResolvedBaseline = {
  path: string;
  runId: string;
  runAttempt: number;
  artifactId: string;
  logicalDate: string;
  manifestSha: string;
};
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const decimal = /^[1-9][0-9]*$/;
const active = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);
const allowedEvents = new Set(["push", "schedule", "workflow_dispatch"]);

function validateOptions(options: ResolveOptions): void {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
    !decimal.test(options.repositoryId)
  )
    throw new VisualRegressionError(
      "BASELINE_API_ERROR",
      "Invalid repository identity",
    );
  if (!sha.test(options.baseSha) || !hash.test(options.contractHash))
    throw new VisualRegressionError(
      "BASELINE_API_ERROR",
      "Invalid baseline lookup identity",
    );
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/.test(options.workflowFile))
    throw new VisualRegressionError(
      "BASELINE_API_ERROR",
      "Invalid baseline workflow filename",
    );
  if (!options.token)
    throw new VisualRegressionError(
      "BASELINE_API_ERROR",
      "GitHub token is unavailable",
    );
}
async function apiJson(
  token: string,
  url: URL,
): Promise<Record<string, unknown>> {
  if (url.origin !== "https://api.github.com")
    throw new Error("Unexpected API origin");
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "BrandonMathis-visual-regression-toolkit/main",
    },
    redirect: "error",
  });
  if (!response.ok)
    throw new VisualRegressionError(
      "BASELINE_API_ERROR",
      `GitHub API returned HTTP ${String(response.status)}`,
      response.status === 429 || response.status >= 500,
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > 10_000_000)
    throw new Error("GitHub API response is oversized");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed GitHub API response");
  return value as Record<string, unknown>;
}
async function pages(
  token: string,
  initial: URL,
  key: string,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = new URL(initial);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const body = await apiJson(token, url);
    const batch = body[key];
    if (!Array.isArray(batch)) throw new Error(`GitHub API omitted ${key}`);
    for (const item of batch as unknown[]) values.push(item);
    if (batch.length < 100) return values;
  }
  throw new VisualRegressionError(
    "BASELINE_API_ERROR",
    "GitHub API pagination cap reached",
    true,
  );
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asRun(value: unknown): Run | undefined {
  const run = object(value);
  const repository = object(run?.repository);
  if (
    !run ||
    !repository ||
    !decimal.test(String(run.id)) ||
    typeof run.run_attempt !== "number" ||
    !Number.isInteger(run.run_attempt)
  )
    return;
  return {
    id: String(run.id),
    run_attempt: run.run_attempt,
    head_sha: String(run.head_sha),
    head_branch: String(run.head_branch),
    event: String(run.event),
    status: String(run.status),
    conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    path: String(run.path),
    repository: {
      id: String(repository.id),
      full_name: String(repository.full_name),
    },
  };
}
function asArtifact(value: unknown): Artifact | undefined {
  const item = object(value);
  if (
    !item ||
    !decimal.test(String(item.id)) ||
    typeof item.name !== "string" ||
    typeof item.expired !== "boolean" ||
    typeof item.size_in_bytes !== "number" ||
    !Number.isInteger(item.size_in_bytes) ||
    typeof item.archive_download_url !== "string"
  )
    return;
  const workflow = object(item.workflow_run);
  return {
    id: String(item.id),
    name: item.name,
    expired: item.expired,
    size_in_bytes: item.size_in_bytes,
    archive_download_url: item.archive_download_url,
    ...(workflow
      ? {
          workflow_run: {
            id: String(workflow.id),
            ...(typeof workflow.head_sha === "string"
              ? { head_sha: workflow.head_sha }
              : {}),
          },
        }
      : {}),
  };
}
export function orderRuns(runs: Run[]): Run[] {
  return [...runs].sort((a, b) => {
    const id = BigInt(b.id) - BigInt(a.id);
    return id === 0n ? b.run_attempt - a.run_attempt : id > 0n ? 1 : -1;
  });
}
function runMatches(run: Run, options: ResolveOptions): boolean {
  return (
    run.head_sha === options.baseSha &&
    run.head_branch === options.baseBranch &&
    run.path === `.github/workflows/${options.workflowFile}` &&
    String(run.repository.id) === options.repositoryId &&
    run.repository.full_name.toLowerCase() ===
      options.repository.toLowerCase() &&
    allowedEvents.has(run.event)
  );
}
async function download(token: string, source: string): Promise<Buffer> {
  let url = new URL(source);
  if (url.origin !== "https://api.github.com")
    throw new Error("Unexpected artifact API origin");
  for (let redirect = 0; redirect < 5; redirect++) {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "BrandonMathis-visual-regression-toolkit/main",
    };
    if (url.origin === "https://api.github.com") {
      headers.Authorization = `Bearer ${token}`;
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    }
    const response = await fetch(url, { headers, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Artifact redirect omitted location");
      url = new URL(location, url);
      if (!["https:"].includes(url.protocol))
        throw new Error("Insecure artifact redirect");
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Artifact download returned HTTP ${String(response.status)}`,
      );
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > ARCHIVE_LIMITS.compressedBytes)
      throw new Error("Artifact archive is oversized");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > ARCHIVE_LIMITS.compressedBytes)
      throw new Error("Artifact archive is oversized");
    return buffer;
  }
  throw new Error("Too many artifact redirects");
}
function runtimeMatches(
  actual: ReleaseIdentity,
  wanted: ReleaseIdentity,
): boolean {
  return (
    actual.authoritative &&
    actual.schemaVersion === wanted.schemaVersion &&
    actual.toolkitCommit === wanted.toolkitCommit &&
    actual.playwrightVersion === wanted.playwrightVersion &&
    actual.chromiumRevision === wanted.chromiumRevision &&
    actual.containerDigest === wanted.containerDigest &&
    actual.os === wanted.os &&
    actual.architecture === wanted.architecture &&
    actual.platform === wanted.platform
  );
}
function manifestMatches(
  manifest: BaselineManifest,
  run: Run,
  options: ResolveOptions,
  wanted: ReleaseIdentity,
): "valid" | "contract" | "incompatible" {
  if (
    manifest.consumerRepository.toLowerCase() !==
      options.repository.toLowerCase() ||
    manifest.sourceSha !== options.baseSha ||
    manifest.baseBranch !== options.baseBranch ||
    manifest.workflowRunId !== run.id ||
    manifest.workflowRunAttempt !== run.run_attempt ||
    !runtimeMatches(manifest.release, wanted)
  )
    return "incompatible";
  return manifest.visualContractHash === options.contractHash
    ? "valid"
    : "contract";
}
async function queryRuns(options: ResolveOptions): Promise<Run[]> {
  const url = new URL(
    `https://api.github.com/repos/${options.repository}/actions/workflows/${encodeURIComponent(options.workflowFile)}/runs`,
  );
  url.searchParams.set("head_sha", options.baseSha);
  return (await pages(options.token, url, "workflow_runs"))
    .map(asRun)
    .filter((run): run is Run => Boolean(run))
    .filter((run) => runMatches(run, options));
}
async function artifactsFor(
  options: ResolveOptions,
  run: Run,
): Promise<Artifact[]> {
  const url = new URL(
    `https://api.github.com/repos/${options.repository}/actions/runs/${run.id}/artifacts`,
  );
  return (await pages(options.token, url, "artifacts"))
    .map(asArtifact)
    .filter((item): item is Artifact => Boolean(item));
}
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveBaseline(
  options: ResolveOptions,
): Promise<ResolvedBaseline> {
  validateOptions(options);
  const deadline = Date.now() + (options.waitSeconds ?? 600) * 1000;
  const wanted = await releaseIdentity(true);
  let observedContract = false,
    observedIncompatible = false,
    observedCorrupt = false,
    observedExpired = false,
    observedUnavailable = false;
  for (;;) {
    const runs = await queryRuns(options);
    const successful = orderRuns(
      runs.filter(
        (run) => run.status === "completed" && run.conclusion === "success",
      ),
    );
    for (const run of successful) {
      const artifacts = await artifactsFor(options, run);
      const candidates = artifacts.filter(
        (artifact) =>
          /^visual-baseline-[a-f0-9]{12}-[a-f0-9]{12}-[1-9][0-9]*-[1-9][0-9]*$/.test(
            artifact.name,
          ) &&
          (!artifact.workflow_run ||
            String(artifact.workflow_run.id) === run.id),
      );
      if (!candidates.length) observedUnavailable = true;
      for (const artifact of candidates.sort((a, b) =>
        BigInt(a.id) > BigInt(b.id) ? -1 : 1,
      )) {
        if (artifact.expired) {
          observedExpired = true;
          continue;
        }
        if (
          artifact.size_in_bytes <= 0 ||
          artifact.size_in_bytes > ARCHIVE_LIMITS.compressedBytes
        ) {
          observedCorrupt = true;
          continue;
        }
        const quarantine = path.join(
          path.dirname(options.output),
          `baseline-quarantine-${run.id}-${artifact.id}`,
        );
        try {
          await extractArtifactZip(
            await download(options.token, artifact.archive_download_url),
            quarantine,
          );
          const verified = await verifyBaseline(quarantine);
          const match = manifestMatches(
            verified.manifest,
            run,
            options,
            wanted,
          );
          if (match === "contract") {
            observedContract = true;
            continue;
          }
          if (match === "incompatible") {
            observedIncompatible = true;
            continue;
          }
          await rm(options.output, { recursive: true, force: true });
          await mkdir(path.dirname(options.output), { recursive: true });
          await import("node:fs/promises").then(({ rename }) =>
            rename(quarantine, options.output),
          );
          const manifestSha = createHash("sha256")
            .update(
              await readFile(
                path.join(options.output, "baseline-manifest.json"),
              ),
            )
            .digest("hex");
          return {
            path: options.output,
            runId: run.id,
            runAttempt: run.run_attempt,
            artifactId: artifact.id,
            logicalDate: verified.manifest.logicalDate,
            manifestSha,
          };
        } catch {
          observedCorrupt = true;
        } finally {
          await rm(quarantine, { recursive: true, force: true });
        }
      }
    }
    if (runs.some((run) => active.has(run.status)) && Date.now() < deadline) {
      await delay(Math.min(30_000, Math.max(5_000, deadline - Date.now())));
      continue;
    }
    if (runs.some((run) => active.has(run.status)))
      throw new VisualRegressionError(
        "BASELINE_NOT_READY",
        "Exact-SHA baseline publication did not complete within the bounded wait",
        true,
      );
    if (observedContract)
      throw new VisualRegressionError(
        "VISUAL_CONTRACT_CHANGED",
        "The exact base SHA has a baseline for a different visual contract",
      );
    if (observedIncompatible)
      throw new VisualRegressionError(
        "BASELINE_INCOMPATIBLE",
        "Exact-SHA baseline artifacts have an incompatible runtime or identity",
      );
    if (observedCorrupt)
      throw new VisualRegressionError(
        "BASELINE_CORRUPT",
        "Exact-SHA baseline artifacts are malformed or fail verification",
      );
    if (observedExpired)
      throw new VisualRegressionError(
        "BASELINE_EXPIRED",
        "Exact-SHA baseline artifact is explicitly expired",
      );
    if (observedUnavailable)
      throw new VisualRegressionError(
        "BASELINE_ARTIFACT_UNAVAILABLE",
        "A successful exact-SHA baseline run has no available artifact",
      );
    throw new VisualRegressionError(
      "BASELINE_NOT_FOUND",
      "No baseline publication exists for the exact PR base SHA",
    );
  }
}
