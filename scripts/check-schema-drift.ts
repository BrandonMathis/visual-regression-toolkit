import { readFile } from "node:fs/promises";
import {
  baselineManifestSchema,
  configSchema,
  visualResultSchema,
} from "../src/contracts/schema-definitions.js";
for (const [name, schema] of Object.entries({
  "config.schema.json": configSchema,
  "baseline-manifest.schema.json": baselineManifestSchema,
  "visual-result.schema.json": visualResultSchema,
})) {
  const expected = `${JSON.stringify(schema, null, 2)}\n`;
  const actual = await readFile(`schemas/${name}`, "utf8");
  if (actual !== expected)
    throw new Error(`Generated schema drift: schemas/${name}`);
}
