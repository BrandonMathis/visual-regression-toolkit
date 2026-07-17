import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dryRun = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});
const parsed = JSON.parse(dryRun) as Array<{
  files: Array<{ path: string }>;
}>;
const files = parsed[0]?.files.map((file) => file.path) ?? [];
if (
  !files.includes("dist/cli/main.js") ||
  !files.includes("dist/index.d.ts") ||
  !files.includes("schemas/baseline-manifest.schema.json") ||
  !files.includes("docs/workflows.md") ||
  !files.includes("SECURITY.md")
)
  throw new Error("Packed tarball is missing required files");
if (
  files.some(
    (file) =>
      file.startsWith("src/") ||
      file.startsWith("tests/") ||
      file.startsWith(".pi-subagents/"),
  )
)
  throw new Error("Packed tarball contains private source/test files");

const temporary = mkdtempSync(path.join(os.tmpdir(), "visual-package-"));
try {
  const packageDirectory = path.join(temporary, "package");
  const consumerDirectory = path.join(temporary, "consumer");
  mkdirSync(packageDirectory);
  mkdirSync(consumerDirectory);
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", packageDirectory],
      { encoding: "utf8" },
    ),
  ) as Array<{ filename: string }>;
  const tarball = path.join(packageDirectory, packed[0]?.filename ?? "");
  execFileSync("npm", ["init", "-y"], {
    cwd: consumerDirectory,
    stdio: "ignore",
  });
  execFileSync("npm", ["install", "--ignore-scripts", tarball], {
    cwd: consumerDirectory,
    stdio: "ignore",
  });
  const help = execFileSync(
    path.join(consumerDirectory, "node_modules/.bin/visual-regression"),
    ["--help"],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (!help.includes("baseline create") || !help.includes("compare --baseline"))
    throw new Error("Packed CLI help is unavailable");
  const publicKeys = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import * as api from '@thisdot/visual-regression'; process.stdout.write(JSON.stringify(Object.keys(api).sort()))",
    ],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (publicKeys !== '["defineVisualConfig"]')
    throw new Error(`Unexpected runtime exports: ${publicKeys}`);
  const privateImport = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import '@thisdot/visual-regression/dist/config/normalize.js'",
    ],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (
    privateImport.status === 0 ||
    !privateImport.stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED")
  )
    throw new Error("Private package internals are importable");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log(
  `Package contains ${String(files.length)} intended files and passes install smoke tests.`,
);
