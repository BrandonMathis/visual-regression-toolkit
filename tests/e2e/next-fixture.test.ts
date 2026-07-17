import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import path from "node:path";

const enabled = process.env.RUN_NEXT_FIXTURE_E2E === "1";
const fixture = path.resolve("tests/fixtures/next-app");
const sourceCli = path.resolve("src/cli/main.ts");
const tsxLoader = path.resolve("node_modules/tsx/dist/loader.mjs");

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const packedCli = process.env.VISUAL_REGRESSION_CLI;
  const command = packedCli
    ? [packedCli, ...args]
    : ["--import", tsxLoader, sourceCli, ...args];
  return spawnSync(process.execPath, command, {
    cwd: fixture,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 20_000_000,
    timeout: 300_000,
  });
}

afterEach(async () => {
  if (enabled)
    await Promise.all([
      rm(path.join(fixture, ".next"), { recursive: true, force: true }),
      rm(path.join(fixture, ".visual-regression"), {
        recursive: true,
        force: true,
      }),
      rm(path.join(fixture, "playwright-report"), {
        recursive: true,
        force: true,
      }),
      rm(path.join(fixture, "test-results"), {
        recursive: true,
        force: true,
      }),
    ]);
});

describe.runIf(enabled)("real Next.js fixture lifecycle", () => {
  it("builds, discovers the complete matrix, and compares unchanged pixels", async () => {
    const fixtureEnv = { VISUAL_FIXTURE_PORT: String(await availablePort()) };
    const common = [
      ...(process.env.VISUAL_REGRESSION_AUTHORITATIVE === "1"
        ? []
        : ["--host"]),
      "--json",
      "--repository",
      "owner/next-fixture",
      "--base-branch",
      "main",
      "--logical-date",
      "2026-07-16T00:00:00.000Z",
    ];
    const baseline = run(
      ["baseline", "create", ...common, "--source-sha", "a".repeat(40)],
      fixtureEnv,
    );
    expect(baseline.status, `${baseline.stderr}\n${baseline.stdout}`).toBe(0);
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          fixture,
          ".visual-regression/baseline/baseline-manifest.json",
        ),
        "utf8",
      ),
    ) as {
      routes: Array<{ route: string }>;
      screenshots: unknown[];
    };
    expect(manifest.routes.map((route) => route.route)).toEqual([
      "/",
      "/additional",
      "/generated/alpha",
      "/generated/unicode-cafe",
    ]);
    expect(manifest.screenshots).toHaveLength(12);

    const comparison = run(
      [
        "compare",
        "--baseline",
        ".visual-regression/baseline",
        ...common,
        "--source-sha",
        "b".repeat(40),
        "--base-sha",
        "a".repeat(40),
      ],
      fixtureEnv,
    );
    expect(
      comparison.status,
      `${comparison.stderr}\n${comparison.stdout}`,
    ).toBe(0);
    expect(JSON.parse(comparison.stdout).status).toBe("pass");
    for (const screenshot of manifest.screenshots as Array<{ path: string }>)
      expect(
        readFileSync(
          path.join(fixture, ".visual-regression/candidate", screenshot.path),
        ),
      ).toEqual(
        readFileSync(
          path.join(fixture, ".visual-regression/baseline", screenshot.path),
        ),
      );

    const changed = run(
      [
        "compare",
        "--baseline",
        ".visual-regression/baseline",
        ...common,
        "--source-sha",
        "c".repeat(40),
        "--base-sha",
        "a".repeat(40),
      ],
      { ...fixtureEnv, VISUAL_FIXTURE_VARIANT: "changed" },
    );
    expect(changed.status, `${changed.stderr}\n${changed.stdout}`).toBe(2);
    expect(JSON.parse(changed.stdout).status).toBe("visual-diff");
  }, 300_000);
});
