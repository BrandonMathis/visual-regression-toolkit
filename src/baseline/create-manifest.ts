import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BaselineManifest,
  CaptureRecord,
  ProjectDescriptor,
  ReleaseIdentity,
  RouteDescriptor,
} from "../contracts/types.js";
import { validateManifestShape } from "../contracts/validate.js";
export async function createManifest(
  directory: string,
  input: {
    consumerRepository: string;
    baseBranch: string;
    sourceSha: string;
    workflowRunId: string;
    workflowRunAttempt: number;
    createdAt: string;
    logicalDate: string;
    release: ReleaseIdentity;
    visualContractHash: string;
    projects: ProjectDescriptor[];
    routes: RouteDescriptor[];
    records: CaptureRecord[];
  },
): Promise<BaselineManifest> {
  const manifest: BaselineManifest = {
    schemaVersion: 1,
    consumerRepository: input.consumerRepository,
    baseBranch: input.baseBranch,
    sourceSha: input.sourceSha,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    createdAt: input.createdAt,
    logicalDate: input.logicalDate,
    release: input.release,
    visualContractHash: input.visualContractHash,
    adapter: "next-prerender-v1",
    stabilizationVersion: 1,
    namingVersion: 1,
    projects: input.projects,
    routes: input.routes,
    screenshots: input.records
      .map((record) => ({
        route: record.route,
        project: record.project,
        path: record.path,
        width: record.width,
        height: record.height,
        byteSize: record.byteSize,
        sha256: record.sha256,
      }))
      .sort((a, b) =>
        `${a.project}\0${a.route}`.localeCompare(`${b.project}\0${b.route}`),
      ),
  };
  validateManifestShape(manifest);
  await writeFile(
    path.join(directory, "baseline-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}
