import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { VisualRegressionError } from "../contracts/error-codes.js";
export async function pixelDiff(
  expectedFile: string,
  actualFile: string,
  diffFile: string,
  threshold: number,
): Promise<{ differingPixels: number; totalPixels: number }> {
  try {
    const expected = PNG.sync.read(await readFile(expectedFile));
    const actual = PNG.sync.read(await readFile(actualFile));
    const width = Math.max(expected.width, actual.width);
    const height = Math.max(expected.height, actual.height);
    const a = new PNG({ width, height });
    const b = new PNG({ width, height });
    const diff = new PNG({ width, height });
    PNG.bitblt(expected, a, 0, 0, expected.width, expected.height, 0, 0);
    PNG.bitblt(actual, b, 0, 0, actual.width, actual.height, 0, 0);
    const pixelDifferences = pixelmatch(
      a.data,
      b.data,
      diff.data,
      width,
      height,
      { threshold },
    );
    const dimensionsChanged =
      expected.width !== actual.width || expected.height !== actual.height;
    const differingPixels = Math.max(
      pixelDifferences,
      dimensionsChanged ? 1 : 0,
    );
    if (differingPixels > 0) {
      await mkdir(path.dirname(diffFile), { recursive: true });
      await writeFile(diffFile, PNG.sync.write(diff));
    }
    return { differingPixels, totalPixels: width * height };
  } catch (error) {
    throw new VisualRegressionError(
      "CAPTURE_FAILED",
      `Pixel comparison failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
