import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import {
  baselineManifestSchema,
  configSchema,
  visualResultSchema,
} from "./schema-definitions.js";
import { VisualRegressionError } from "./error-codes.js";
import type {
  BaselineManifest,
  VisualRegressionConfig,
  VisualResult,
} from "./types.js";

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: true,
});
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)),
});
const compile = (schema: AnySchema): ValidateFunction => ajv.compile(schema);
const validators = {
  config: compile(configSchema),
  baseline: compile(baselineManifestSchema),
  result: compile(visualResultSchema),
};
function assertValid<T>(
  validator: ValidateFunction,
  value: unknown,
  label: string,
): asserts value is T {
  if (!validator(value)) {
    const details = (validator.errors ?? [])
      .slice(0, 12)
      .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
      .join("; ");
    throw new VisualRegressionError(
      label === "configuration"
        ? "CONFIG_INVALID"
        : label === "baseline manifest"
          ? "BASELINE_CORRUPT"
          : "INTERNAL_ERROR",
      `Invalid ${label}: ${details}`,
    );
  }
}
export function validateConfigShape(
  value: unknown,
): asserts value is VisualRegressionConfig {
  assertValid<VisualRegressionConfig>(
    validators.config,
    value,
    "configuration",
  );
}
export function validateManifestShape(
  value: unknown,
): asserts value is BaselineManifest {
  assertValid<BaselineManifest>(
    validators.baseline,
    value,
    "baseline manifest",
  );
}
export function validateResult(value: unknown): asserts value is VisualResult {
  assertValid<VisualResult>(validators.result, value, "visual result");
}
