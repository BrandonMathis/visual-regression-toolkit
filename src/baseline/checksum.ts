import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { VisualRegressionError } from "../contracts/error-codes.js";
export async function inspectPng(file: string): Promise<{
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Screenshot cannot be read",
    );
  }
  let png: PNG;
  try {
    png = PNG.sync.read(bytes, { skipRescale: true });
  } catch {
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Screenshot is not a valid PNG",
    );
  }
  return {
    width: png.width,
    height: png.height,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
