import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VisualResult } from "../contracts/types.js";
import { validateResult } from "../contracts/validate.js";
import { html, markdown } from "../reporters/render.js";
import { ensureSafeDirectory } from "../platform/paths.js";
async function atomic(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, file);
}
export async function writeResult(
  root: string,
  result: VisualResult,
): Promise<void> {
  validateResult(result);
  await ensureSafeDirectory(root, ".visual-regression/result");
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (Buffer.byteLength(json) > 1_000_000)
    throw new Error("Result exceeds 1 MiB");
  await atomic(
    path.join(root, ".visual-regression/result/visual-result.json"),
    json,
  );
  await atomic(
    path.join(root, ".visual-regression/result/visual-summary.md"),
    `${markdown(result)}\n`,
  );
  await atomic(
    path.join(root, ".visual-regression/result/visual-report.html"),
    html(result),
  );
}
