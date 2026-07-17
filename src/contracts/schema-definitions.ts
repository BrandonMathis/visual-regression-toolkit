const str = (maxLength = 4096) => ({ type: "string", minLength: 1, maxLength });
const stringArray = (maxItems = 256) => ({
  type: "array",
  maxItems,
  items: str(1024),
});
const project = {
  type: "object",
  additionalProperties: false,
  required: ["name", "width", "height"],
  properties: {
    name: { type: "string", pattern: "^[a-z][a-z0-9-]{0,31}$" },
    width: { type: "integer", minimum: 1, maximum: 8192 },
    height: { type: "integer", minimum: 1, maximum: 8192 },
    hasTouch: { type: "boolean" },
    isMobile: { type: "boolean" },
    deviceScaleFactor: { type: "number", minimum: 1, maximum: 4 },
  },
};
const release = {
  type: "object",
  additionalProperties: false,
  required: [
    "toolkitCommit",
    "schemaVersion",
    "playwrightVersion",
    "chromiumRevision",
    "containerDigest",
    "os",
    "architecture",
    "platform",
    "authoritative",
  ],
  properties: {
    toolkitCommit: { type: "string", pattern: "^[a-f0-9]{40}$" },
    schemaVersion: { const: 1 },
    playwrightVersion: { const: "1.61.1" },
    chromiumRevision: str(64),
    containerDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    os: str(32),
    architecture: str(32),
    platform: str(64),
    authoritative: { type: "boolean" },
  },
};
const difference = {
  type: "object",
  additionalProperties: false,
  required: ["route", "project"],
  properties: {
    route: str(2048),
    project: str(32),
    expectedPath: str(4096),
    actualPath: str(4096),
    diffPath: str(4096),
    differingPixels: { type: "integer", minimum: 0 },
    totalPixels: { type: "integer", minimum: 0 },
  },
};
export const configSchema = {
  $id: "https://thisdot.co/schemas/visual-regression/config-v1.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["framework", "commands", "server"],
  properties: {
    framework: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "next-prerender" },
        manifestPath: str(1024),
      },
    },
    commands: {
      type: "object",
      additionalProperties: false,
      required: ["build", "start"],
      properties: { build: str(), start: str() },
    },
    server: {
      type: "object",
      additionalProperties: false,
      required: ["origin"],
      properties: {
        origin: str(256),
        readinessPath: str(1024),
        startupTimeoutMs: { type: "integer", minimum: 100, maximum: 600000 },
      },
    },
    routes: {
      type: "object",
      additionalProperties: false,
      properties: {
        include: stringArray(),
        exclude: stringArray(),
        additional: stringArray(),
      },
    },
    clock: {
      type: "object",
      additionalProperties: false,
      properties: {
        environmentVariable: {
          type: "string",
          pattern: "^[A-Z_][A-Z0-9_]{0,63}$",
        },
      },
    },
    projects: { type: "array", minItems: 1, maxItems: 16, items: project },
    capture: {
      type: "object",
      additionalProperties: false,
      properties: {
        colorScheme: { enum: ["light", "dark"] },
        locale: str(64),
        timezoneId: str(128),
        reducedMotion: { enum: ["reduce", "no-preference"] },
        fontChecks: stringArray(64),
        readinessSelectors: stringArray(64),
        masks: stringArray(64),
        externalRequests: {
          type: "object",
          additionalProperties: false,
          properties: { default: { const: "block" }, allow: stringArray(64) },
        },
        screenshot: {
          type: "object",
          additionalProperties: false,
          properties: {
            fullPage: { const: true },
            threshold: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        navigationTimeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
        stabilizationTimeoutMs: {
          type: "integer",
          minimum: 100,
          maximum: 120000,
        },
        maxScrollPasses: { type: "integer", minimum: 1, maximum: 1000 },
        maxDocumentHeight: { type: "integer", minimum: 1, maximum: 100000 },
        maxResources: { type: "integer", minimum: 1, maximum: 10000 },
      },
    },
  },
} as const;
export const baselineManifestSchema = {
  $id: "https://thisdot.co/schemas/visual-regression/baseline-v1.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "consumerRepository",
    "baseBranch",
    "sourceSha",
    "workflowRunId",
    "workflowRunAttempt",
    "createdAt",
    "logicalDate",
    "release",
    "visualContractHash",
    "adapter",
    "stabilizationVersion",
    "namingVersion",
    "projects",
    "routes",
    "screenshots",
  ],
  properties: {
    schemaVersion: { const: 1 },
    consumerRepository: {
      type: "string",
      pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
    },
    baseBranch: str(255),
    sourceSha: { type: "string", pattern: "^[a-f0-9]{40}$" },
    workflowRunId: { type: "string", pattern: "^[0-9]+$" },
    workflowRunAttempt: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    logicalDate: { type: "string", format: "date-time" },
    release,
    visualContractHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    adapter: { const: "next-prerender-v1" },
    stabilizationVersion: { const: 1 },
    namingVersion: { const: 1 },
    projects: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: {
        ...project,
        required: [
          "name",
          "width",
          "height",
          "hasTouch",
          "isMobile",
          "deviceScaleFactor",
        ],
      },
    },
    routes: {
      type: "array",
      minItems: 1,
      maxItems: 5000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["route", "fileName"],
        properties: { route: str(2048), fileName: str(255) },
      },
    },
    screenshots: {
      type: "array",
      minItems: 1,
      maxItems: 50000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "route",
          "project",
          "path",
          "width",
          "height",
          "byteSize",
          "sha256",
        ],
        properties: {
          route: str(2048),
          project: str(32),
          path: str(4096),
          width: { type: "integer", minimum: 1, maximum: 100000 },
          height: { type: "integer", minimum: 1, maximum: 100000 },
          byteSize: { type: "integer", minimum: 1, maximum: 100000000 },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
      },
    },
  },
} as const;
export const visualResultSchema = {
  $id: "https://thisdot.co/schemas/visual-regression/result-v1.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "operation",
    "status",
    "candidateSha",
    "routeTotal",
    "screenshotTotal",
    "changed",
    "added",
    "removed",
    "reportPaths",
  ],
  properties: {
    schemaVersion: { const: 1 },
    operation: { enum: ["baseline-create", "compare"] },
    status: { enum: ["pass", "visual-diff", "infrastructure-error"] },
    candidateSha: { type: "string", pattern: "^(?:[a-f0-9]{40}|unknown)$" },
    baselineSha: { type: "string", pattern: "^[a-f0-9]{40}$" },
    visualContractHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    runtime: release,
    routeTotal: { type: "integer", minimum: 0, maximum: 5000 },
    screenshotTotal: { type: "integer", minimum: 0, maximum: 50000 },
    changed: { type: "array", maxItems: 5000, items: difference },
    added: { type: "array", maxItems: 5000, items: difference },
    removed: { type: "array", maxItems: 5000, items: difference },
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "retryable"],
      properties: {
        code: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$" },
        message: str(2048),
        retryable: { type: "boolean" },
      },
    },
    reportPaths: { type: "array", maxItems: 16, items: str(4096) },
  },
  allOf: [
    {
      if: {
        properties: { status: { const: "infrastructure-error" } },
        required: ["status"],
      },
      then: {
        required: ["error"],
        properties: {
          error: {},
          changed: { type: "array", maxItems: 0 },
          added: { type: "array", maxItems: 0 },
          removed: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: {
        properties: { status: { const: "visual-diff" } },
        required: ["status"],
      },
      then: {
        properties: { operation: { const: "compare" } },
        not: { properties: { error: {} }, required: ["error"] },
        anyOf: [
          { properties: { changed: { type: "array", minItems: 1 } } },
          { properties: { added: { type: "array", minItems: 1 } } },
          { properties: { removed: { type: "array", minItems: 1 } } },
        ],
      },
    },
    {
      if: {
        properties: { status: { const: "pass" } },
        required: ["status"],
      },
      then: {
        not: { properties: { error: {} }, required: ["error"] },
        properties: {
          changed: { type: "array", maxItems: 0 },
          added: { type: "array", maxItems: 0 },
          removed: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: {
        properties: {
          operation: { const: "compare" },
          status: { enum: ["pass", "visual-diff"] },
        },
        required: ["operation", "status"],
      },
      then: {
        properties: { baselineSha: {} },
        required: ["baselineSha"],
      },
    },
    {
      if: {
        properties: { operation: { const: "baseline-create" } },
        required: ["operation"],
      },
      then: {
        allOf: [
          {
            not: {
              properties: { status: { const: "visual-diff" } },
              required: ["status"],
            },
          },
          {
            not: {
              properties: { baselineSha: {} },
              required: ["baselineSha"],
            },
          },
        ],
      },
    },
  ],
} as const;
