import { afterEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yazl from "yazl";
import {
  inspectConsumer,
  scanArtifactTree,
} from "../../src/workflow/consumer.js";
import {
  orderRuns,
  resolveBaseline,
  type Run,
} from "../../src/workflow/resolve-baseline.js";
import { validateWorkflowResult } from "../../src/workflow/result-gate.js";
import { extractArtifactZip } from "../../src/workflow/archive.js";
import { releaseIdentity } from "../../src/platform/release.js";
import { baseline, png } from "../helpers.js";
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-helper-"));
  roots.push(root);
  return root;
}
async function archive(
  entries: Array<{ name: string; data?: string | Buffer; mode?: number }>,
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const entry of entries)
    zip.addBuffer(
      Buffer.isBuffer(entry.data)
        ? entry.data
        : Buffer.from(entry.data ?? "data"),
      entry.name,
      entry.mode === undefined ? {} : { mode: entry.mode },
    );
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("workflow trust helpers", () => {
  it("inspects a plain consumer config without an npm toolkit dependency", async () => {
    const root = await temporary();
    const toolkitCommit = "e".repeat(40);
    vi.stubEnv("VISUAL_REGRESSION_TOOLKIT_COMMIT", toolkitCommit);
    await writeFile(
      path.join(root, "visual-regression.config.ts"),
      `export default { framework: { type: "next-prerender" }, commands: { build: "npm run build", start: "npm start" }, server: { origin: "http://127.0.0.1:3000" } };`,
    );
    await expect(
      inspectConsumer(root, "visual-regression.config.ts"),
    ).resolves.toMatchObject({
      toolkitCommit,
      contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("requires an explicit nonzero toolkit commit for authoritative identity", async () => {
    vi.stubEnv("VISUAL_REGRESSION_TOOLKIT_COMMIT", "0".repeat(40));
    await expect(releaseIdentity(true)).rejects.toThrow(/toolkit.commit/i);
    const toolkitCommit = "e".repeat(40);
    vi.stubEnv("VISUAL_REGRESSION_TOOLKIT_COMMIT", toolkitCommit);
    await expect(releaseIdentity(true)).resolves.toMatchObject({
      toolkitCommit,
      authoritative: true,
    });
  });

  it("orders arbitrarily large run IDs and attempts deterministically", () => {
    const base = {
      head_sha: "a".repeat(40),
      head_branch: "main",
      event: "push",
      status: "completed",
      conclusion: "success",
      path: ".github/workflows/visual-baseline.yml",
      repository: { id: "1", full_name: "owner/repo" },
    };
    const runs: Run[] = [
      { ...base, id: "90071992547409931234", run_attempt: 1 },
      { ...base, id: "90071992547409931235", run_attempt: 1 },
      { ...base, id: "90071992547409931235", run_attempt: 2 },
    ];
    expect(
      orderRuns(runs).map((run) => `${run.id}/${run.run_attempt}`),
    ).toEqual([
      "90071992547409931235/2",
      "90071992547409931235/1",
      "90071992547409931234/1",
    ]);
  });

  it("selects only an exact-SHA, exact-name, verified baseline artifact", async () => {
    const root = await temporary();
    const source = path.join(root, "source");
    const toolkitCommit = "d".repeat(40);
    vi.stubEnv("VISUAL_REGRESSION_TOOLKIT_COMMIT", toolkitCommit);
    await mkdir(source);
    const manifest = await baseline(source);
    manifest.release = {
      toolkitCommit,
      schemaVersion: 1,
      playwrightVersion: "1.61.1",
      chromiumRevision: "1228",
      containerDigest:
        "sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6",
      os: "linux",
      architecture: "x64",
      platform: "linux/amd64",
      authoritative: true,
    };
    await writeFile(
      path.join(source, "baseline-manifest.json"),
      JSON.stringify(manifest),
    );
    const zip = await archive([
      {
        name: "baseline-manifest.json",
        data: await readFile(path.join(source, "baseline-manifest.json")),
      },
      {
        name: "screenshots/desktop/home.png",
        data: await readFile(path.join(source, "screenshots/desktop/home.png")),
      },
    ]);
    const runId = "12345678901234567890";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL) => {
        const url = new URL(String(input));
        if (url.hostname === "objects.example")
          return new Response(Uint8Array.from(zip), {
            status: 200,
            headers: { "content-length": String(zip.byteLength) },
          });
        if (url.pathname.endsWith("/runs"))
          return Response.json({
            workflow_runs: [
              {
                id: runId,
                run_attempt: 1,
                head_sha: "a".repeat(40),
                head_branch: "main",
                event: "push",
                status: "completed",
                conclusion: "success",
                path: ".github/workflows/visual-baseline.yml",
                repository: { id: 1, full_name: "owner/repo" },
              },
            ],
          });
        if (url.pathname.endsWith(`/runs/${runId}/artifacts`))
          return Response.json({
            artifacts: [
              {
                id: "78",
                name: `visual-baseline-diagnostics-${runId}-1`,
                expired: false,
                size_in_bytes: zip.byteLength,
                archive_download_url:
                  "https://api.github.com/repos/owner/repo/actions/artifacts/78/zip",
                workflow_run: { id: runId },
              },
              {
                id: "77",
                name: `visual-baseline-${"a".repeat(12)}-${"c".repeat(12)}-${runId}-1`,
                expired: false,
                size_in_bytes: zip.byteLength,
                archive_download_url:
                  "https://api.github.com/repos/owner/repo/actions/artifacts/77/zip",
                workflow_run: { id: runId },
              },
            ],
          });
        if (url.pathname.endsWith("/artifacts/77/zip"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://objects.example/baseline.zip" },
          });
        throw new Error(`Unexpected URL: ${url.toString()}`);
      }),
    );
    const output = path.join(root, "selected");
    await expect(
      resolveBaseline({
        repository: "owner/repo",
        repositoryId: "1",
        baseSha: "a".repeat(40),
        contractHash: "c".repeat(64),
        baseBranch: "main",
        workflowFile: "visual-baseline.yml",
        output,
        token: "test-token",
        waitSeconds: 0,
      }),
    ).resolves.toMatchObject({
      path: output,
      runId,
      runAttempt: 1,
      artifactId: "77",
    });
  });

  it("rejects symlinks from fixed artifact upload trees", async () => {
    const root = await temporary();
    await writeFile(path.join(root, "file.txt"), "safe");
    await symlink(path.join(root, "file.txt"), path.join(root, "link.txt"));
    await expect(scanArtifactTree(root)).rejects.toThrow(/symlink/);
  });

  it("safely extracts regular artifact ZIPs and rejects collisions or links", async () => {
    const root = await temporary();
    const valid = path.join(root, "valid");
    await expect(
      extractArtifactZip(
        await archive([{ name: "screenshots/desktop/home.png" }]),
        valid,
      ),
    ).resolves.toBeUndefined();
    await expect(
      extractArtifactZip(
        await archive([
          { name: "screenshots/Home.png" },
          { name: "screenshots/home.png" },
        ]),
        path.join(root, "collision"),
      ),
    ).rejects.toMatchObject({ code: "BASELINE_CORRUPT" });
    await expect(
      extractArtifactZip(
        await archive([{ name: "screenshots/link", mode: 0o120777 }]),
        path.join(root, "link"),
      ),
    ).rejects.toMatchObject({ code: "BASELINE_CORRUPT" });
  });

  it("accepts a complete advisory result and rejects a forged runtime identity", async () => {
    const root = await temporary();
    const candidate = "b".repeat(40);
    const contract = "c".repeat(64);
    const toolkitCommit = "d".repeat(40);
    vi.stubEnv("VISUAL_REGRESSION_TOOLKIT_COMMIT", toolkitCommit);
    const expectedPath =
      ".visual-regression/baseline/screenshots/desktop/home.png";
    const actualPath =
      ".visual-regression/candidate/screenshots/desktop/home.png";
    const diffPath = ".visual-regression/result/diffs/desktop/home.png";
    for (const relative of [expectedPath, actualPath, diffPath])
      await png(path.join(root, relative));
    for (const relative of [
      ".visual-regression/result/visual-summary.md",
      ".visual-regression/result/visual-report.html",
      "playwright-report/visual/index.html",
    ]) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), "report");
    }
    const result = {
      schemaVersion: 1,
      operation: "compare",
      status: "visual-diff",
      candidateSha: candidate,
      baselineSha: "a".repeat(40),
      visualContractHash: contract,
      runtime: {
        toolkitCommit,
        schemaVersion: 1,
        playwrightVersion: "1.61.1",
        chromiumRevision: "1228",
        containerDigest:
          "sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6",
        os: "linux",
        architecture: "x64",
        platform: "linux/amd64",
        authoritative: true,
      },
      routeTotal: 1,
      screenshotTotal: 1,
      changed: [
        {
          route: "/",
          project: "desktop",
          expectedPath,
          actualPath,
          diffPath,
          differingPixels: 1,
          totalPixels: 1,
        },
      ],
      added: [],
      removed: [],
      reportPaths: [
        ".visual-regression/result/visual-summary.md",
        ".visual-regression/result/visual-report.html",
        "playwright-report/visual/index.html",
      ],
    };
    const resultFile = path.join(
      root,
      ".visual-regression/result/visual-result.json",
    );
    await writeFile(resultFile, JSON.stringify(result));
    const options = {
      root,
      operation: "compare" as const,
      exitCode: 2,
      candidateSha: candidate,
      baselineSha: "a".repeat(40),
      contractHash: contract,
      summaryPath: path.join(root, "trusted-summary.md"),
      informational: true,
    };
    await expect(validateWorkflowResult(options)).resolves.toEqual({
      status: "visual-diff",
      conclusion: "advisory",
    });
    result.runtime.chromiumRevision = "wrong";
    await writeFile(resultFile, JSON.stringify(result));
    await expect(validateWorkflowResult(options)).rejects.toMatchObject({
      code: "RESULT_IDENTITY_MISMATCH",
    });
    result.runtime.chromiumRevision = "1228";
    result.changed[0]!.expectedPath = actualPath;
    result.changed[0]!.diffPath = actualPath;
    await writeFile(resultFile, JSON.stringify(result));
    await expect(validateWorkflowResult(options)).rejects.toThrow(
      /paths|reuse/i,
    );
  });

  it("accepts only an identity-correlated infrastructure result and matching exit", async () => {
    const root = await temporary();
    const resultRoot = path.join(root, ".visual-regression/result");
    await mkdir(resultRoot, { recursive: true });
    const candidate = "b".repeat(40);
    const result = {
      schemaVersion: 1,
      operation: "compare",
      status: "infrastructure-error",
      candidateSha: candidate,
      routeTotal: 0,
      screenshotTotal: 0,
      changed: [],
      added: [],
      removed: [],
      error: {
        code: "BUILD_FAILED",
        message: "build failed",
        retryable: false,
      },
      reportPaths: [
        ".visual-regression/result/visual-summary.md",
        ".visual-regression/result/visual-report.html",
      ],
    };
    await writeFile(
      path.join(resultRoot, "visual-result.json"),
      JSON.stringify(result),
    );
    await writeFile(path.join(resultRoot, "visual-summary.md"), "summary");
    await writeFile(path.join(resultRoot, "visual-report.html"), "report");
    await expect(
      validateWorkflowResult({
        root,
        operation: "compare",
        exitCode: 1,
        candidateSha: candidate,
        baselineSha: "a".repeat(40),
        summaryPath: path.join(root, "summary.md"),
        informational: true,
      }),
    ).resolves.toEqual({
      status: "infrastructure-error",
      conclusion: "failure",
    });
    await expect(
      validateWorkflowResult({
        root,
        operation: "compare",
        exitCode: 2,
        candidateSha: candidate,
        baselineSha: "a".repeat(40),
        summaryPath: path.join(root, "summary.md"),
        informational: true,
      }),
    ).rejects.toMatchObject({ code: "RESULT_INVALID" });
  });
});
