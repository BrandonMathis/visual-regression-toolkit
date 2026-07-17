import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const directory = ".github/workflows";
const files = (await readdir(directory)).filter((file) =>
  /\.ya?ml$/.test(file),
);
const shaUse = /^\s*uses:\s*[^\s#]+@([a-f0-9]{40})(?:\s*#.*)?$/;
const anyUse = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/;
const digest =
  "mcr.microsoft.com/playwright:v1.61.1-noble@sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6";
for (const file of files) {
  const text = await readFile(path.join(directory, file), "utf8");
  for (const [index, line] of text.split("\n").entries()) {
    if (anyUse.test(line) && !shaUse.test(line.replace(/^\s*-\s*/, "      ")))
      throw new Error(
        `${file}:${index + 1}: external uses must have a full commit SHA`,
      );
    if (
      /^\s*image:\s*mcr\.microsoft\.com\/playwright:/.test(line) &&
      !line.includes(digest)
    )
      throw new Error(
        `${file}:${index + 1}: Playwright container must use the paired digest`,
      );
  }
}
console.log(`Validated immutable references in ${files.length} workflows.`);
