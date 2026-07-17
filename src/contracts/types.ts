export type Project = {
  name: string;
  width: number;
  height: number;
  hasTouch?: boolean;
  isMobile?: boolean;
  deviceScaleFactor?: number;
};

export type VisualRegressionConfig = {
  framework: { type: "next-prerender"; manifestPath?: string };
  commands: { build: string; start: string };
  server: { origin: string; readinessPath?: string; startupTimeoutMs?: number };
  routes?: { include?: string[]; exclude?: string[]; additional?: string[] };
  clock?: { environmentVariable?: string };
  projects?: Project[];
  capture?: {
    colorScheme?: "light" | "dark";
    locale?: string;
    timezoneId?: string;
    reducedMotion?: "reduce" | "no-preference";
    fontChecks?: string[];
    readinessSelectors?: string[];
    masks?: string[];
    externalRequests?: { default?: "block"; allow?: string[] };
    screenshot?: { fullPage?: true; threshold?: number };
    navigationTimeoutMs?: number;
    stabilizationTimeoutMs?: number;
    maxScrollPasses?: number;
    maxDocumentHeight?: number;
    maxResources?: number;
  };
};

export type NormalizedConfig = {
  framework: { type: "next-prerender"; manifestPath: string };
  commands: { build: string; start: string };
  server: { origin: string; readinessPath: string; startupTimeoutMs: number };
  routes: { include: string[]; exclude: string[]; additional: string[] };
  clock: { environmentVariable: string };
  projects: Array<Required<Project>>;
  capture: {
    colorScheme: "light" | "dark";
    locale: string;
    timezoneId: string;
    reducedMotion: "reduce" | "no-preference";
    fontChecks: string[];
    readinessSelectors: string[];
    masks: string[];
    externalRequests: { default: "block"; allow: string[] };
    screenshot: { fullPage: true; threshold: number };
    navigationTimeoutMs: number;
    stabilizationTimeoutMs: number;
    maxScrollPasses: number;
    maxDocumentHeight: number;
    maxResources: number;
  };
};

export type ReleaseIdentity = {
  toolkitCommit: string;
  schemaVersion: 1;
  playwrightVersion: string;
  chromiumRevision: string;
  containerDigest: string;
  os: string;
  architecture: string;
  platform: string;
  authoritative: boolean;
};
export type ProjectDescriptor = Required<Project>;
export type RouteDescriptor = { route: string; fileName: string };
export type ScreenshotDescriptor = {
  route: string;
  project: string;
  path: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};
export type BaselineManifest = {
  schemaVersion: 1;
  consumerRepository: string;
  baseBranch: string;
  sourceSha: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  createdAt: string;
  logicalDate: string;
  release: ReleaseIdentity;
  visualContractHash: string;
  adapter: "next-prerender-v1";
  stabilizationVersion: 1;
  namingVersion: 1;
  projects: ProjectDescriptor[];
  routes: RouteDescriptor[];
  screenshots: ScreenshotDescriptor[];
};
export type Difference = {
  route: string;
  project: string;
  expectedPath?: string;
  actualPath?: string;
  diffPath?: string;
  differingPixels?: number;
  totalPixels?: number;
};
export type VisualResultStatus =
  | "pass"
  | "visual-diff"
  | "infrastructure-error";
type ResultEvidence = {
  schemaVersion: 1;
  candidateSha: string;
  visualContractHash?: string;
  runtime?: ReleaseIdentity;
  routeTotal: number;
  screenshotTotal: number;
  changed: Difference[];
  added: Difference[];
  removed: Difference[];
  reportPaths: string[];
};
type InfrastructureFailure = {
  status: "infrastructure-error";
  baselineSha?: string;
  error: { code: string; message: string; retryable: boolean };
};
export type VisualResult =
  | (ResultEvidence & {
      operation: "baseline-create";
      status: "pass";
      baselineSha?: never;
      error?: never;
    })
  | (ResultEvidence & {
      operation: "compare";
      status: "pass";
      baselineSha: string;
      error?: never;
    })
  | (ResultEvidence & {
      operation: "compare";
      status: "visual-diff";
      baselineSha: string;
      error?: never;
    })
  | (ResultEvidence &
      InfrastructureFailure & {
        operation: "baseline-create";
        baselineSha?: never;
      })
  | (ResultEvidence & InfrastructureFailure & { operation: "compare" });

export type CaptureRecord = ScreenshotDescriptor & { absolutePath: string };
