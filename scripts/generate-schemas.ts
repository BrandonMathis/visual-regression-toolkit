import { mkdir, writeFile } from "node:fs/promises";
import {
  baselineManifestSchema,
  configSchema,
  visualResultSchema,
} from "../src/contracts/schema-definitions.js";
await mkdir("schemas", { recursive: true });
for (const [name, schema] of Object.entries({
  "config.schema.json": configSchema,
  "baseline-manifest.schema.json": baselineManifestSchema,
  "visual-result.schema.json": visualResultSchema,
}))
  await writeFile(`schemas/${name}`, `${JSON.stringify(schema, null, 2)}\n`);
