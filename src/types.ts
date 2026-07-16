/**
 * Shared contract types for the visual regression toolkit.
 *
 * Public API surface (re-exported from src/index.ts): defineVisualConfig,
 * VisualRegressionConfig, VisualResult, VisualResultStatus. Everything else
 * is internal to the toolkit and its CLI/workflows.
 */

// ---------------------------------------------------------------------------
// Configuration input (plan §5.2)
// ---------------------------------------------------------------------------

export interface VisualProjectConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  hasTouch?: boolean;
  isMobile?: boolean;
}

export interface VisualRegressionConfig {
  framework: {
    type: 'next-prerender';
    /** Relative to the consumer repo root. Default: '.next/prerender-manifest.json'. */
    manifestPath?: string;
  };
  commands: {
    build: string;
    start: string;
  };
  server: {
    /** Must be a loopback origin in v1 (http://127.0.0.1:<port> or http://localhost:<port>). */
    origin: string;
    /** Default: '/'. */
    readinessPath?: string;
    /** Default: 120_000. */
    startupTimeoutMs?: number;
  };
  routes?: {
    /** Glob patterns applied to discovered routes. Default: ['/**']. */
    include?: string[];
    exclude?: string[];
    /** Explicit extra routes (must start with '/'). */
    additional?: string[];
  };
  clock?: {
    /** Env var receiving the logical date for build/start/capture. Default: 'VISUAL_TEST_DATE'. */
    environmentVariable?: string;
  };
  /** Overrides the three default projects. Names must be unique and filesystem-safe. */
  projects?: VisualProjectConfig[];
  capture?: {
    colorScheme?: 'light' | 'dark';
    locale?: string;
    timezoneId?: string;
    reducedMotion?: 'reduce' | 'no-preference';
    /** CSS font-family names probed via document.fonts.check after fonts.ready. */
    fontChecks?: string[];
    /** CSS selectors that must be visible before capture. */
    readinessSelectors?: string[];
    /** CSS selectors masked during screenshots. */
    masks?: string[];
    externalRequests?: {
      /** Default: 'block'. */
      default?: 'block' | 'allow';
      /** Origins or the literals 'self', 'data:', 'blob:'. Default: ['self', 'data:', 'blob:']. */
      allow?: string[];
    };
    screenshot?: {
      /** Default: true. */
      fullPage?: boolean;
      /** Per-pixel color threshold (0..1) for comparison. Default: 0.2. */
      threshold?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Resolved (normalized, fully defaulted) configuration
// ---------------------------------------------------------------------------

export interface ResolvedProject {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  hasTouch: boolean;
  isMobile: boolean;
}

export interface ResolvedVisualConfig {
  /** Absolute path of the consumer repository root. */
  repoRoot: string;
  /** Absolute path of the loaded config file. */
  configPath: string;
  framework: {
    type: 'next-prerender';
    /** Absolute path to the prerender manifest. */
    manifestPath: string;
  };
  commands: { build: string; start: string };
  server: { origin: string; readinessPath: string; startupTimeoutMs: number };
  routes: { include: string[]; exclude: string[]; additional: string[] };
  clock: { environmentVariable: string };
  projects: ResolvedProject[];
  capture: {
    colorScheme: 'light' | 'dark';
    locale: string;
    timezoneId: string;
    reducedMotion: 'reduce' | 'no-preference';
    fontChecks: string[];
    readinessSelectors: string[];
    masks: string[];
    externalRequests: { default: 'block' | 'allow'; allow: string[] };
    screenshot: { fullPage: boolean; threshold: number };
  };
}

export const DEFAULT_PROJECTS: ResolvedProject[] = [
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  {
    name: 'tablet',
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: false,
  },
  { name: 'phone', width: 375, height: 812, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
];

// ---------------------------------------------------------------------------
// Routes and screenshots (plan §6)
// ---------------------------------------------------------------------------

export interface RouteDescriptor {
  /** Original route as discovered/configured, e.g. '/', '/about'. */
  route: string;
  /** Portable file name (no directories), e.g. 'home.png', 'about.png'. */
  screenshotName: string;
}

export interface ScreenshotEntry {
  project: string;
  route: string;
  /** Path relative to the baseline dir, POSIX separators, e.g. 'screenshots/desktop/home.png'. */
  path: string;
  width: number;
  height: number;
  bytes: number;
  /** Lowercase hex SHA-256 of the file content. */
  sha256: string;
}

// ---------------------------------------------------------------------------
// Baseline manifest (plan §8.1)
// ---------------------------------------------------------------------------

export interface BaselineManifest {
  schemaVersion: number;
  /** 'owner/name'. */
  repository: string;
  baseBranch: string;
  /** Full 40-char commit SHA. */
  sourceSha: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  /** UTC ISO-8601 creation time. */
  createdAt: string;
  /** Logical date injected into the clock env var for build/start/capture. */
  logicalDate: string;
  toolkit: { name: string; version: string };
  playwrightVersion: string;
  chromiumRevision: string;
  environment: {
    os: string;
    arch: string;
    /** 'sha256:...' image digest, or 'host' for non-authoritative diagnostic runs. */
    containerDigest: string;
    /** e.g. 'linux/amd64', or 'host'. */
    platform: string;
  };
  visualContractHash: string;
  adapter: { type: 'next-prerender'; behaviorVersion: number };
  projects: ResolvedProject[];
  routes: RouteDescriptor[];
  screenshots: ScreenshotEntry[];
}

/** Everything that must match for a baseline to be usable (plan §8.3). */
export interface CompatibilityIdentity {
  repository: string;
  sourceSha: string;
  visualContractHash: string;
  toolkitMajor: number;
  schemaVersion: number;
  playwrightVersion: string;
  chromiumRevision: string;
  containerDigest: string;
  platform: string;
}

// ---------------------------------------------------------------------------
// Results (plan §10)
// ---------------------------------------------------------------------------

export type VisualResultStatus = 'pass' | 'infrastructure-error' | 'visual-diff';
export type VisualOperation = 'baseline-create' | 'compare';
export type ComparisonEntryStatus = 'unchanged' | 'changed' | 'added' | 'removed';

export interface ComparisonEntry {
  project: string;
  route: string;
  screenshotName: string;
  status: ComparisonEntryStatus;
  /** Paths relative to the repo root; null when the side does not exist. */
  expectedPath: string | null;
  actualPath: string | null;
  diffPath: string | null;
  /** Fraction of differing pixels (0..1); null for added/removed. */
  diffPixelRatio: number | null;
}

export interface VisualResultError {
  code: string;
  message: string;
  retryable: boolean;
  context?: Record<string, string>;
}

export interface VisualResult {
  schemaVersion: number;
  operation: VisualOperation;
  status: VisualResultStatus;
  createdAt: string;
  /** Full SHA of the candidate commit, or null when unknown (e.g. host diagnostics). */
  candidateSha: string | null;
  /** Identity of the baseline compared against; null for baseline-create or early failures. */
  baseline: {
    sourceSha: string;
    visualContractHash: string;
    toolkitVersion: string;
    playwrightVersion: string;
    chromiumRevision: string;
    containerDigest: string;
    platform: string;
  } | null;
  visualContractHash: string | null;
  runtime: {
    toolkitVersion: string;
    playwrightVersion: string;
    chromiumRevision: string;
    os: string;
    arch: string;
    /** True when produced with --host (never authoritative). */
    host: boolean;
  };
  totals: {
    routes: number;
    screenshots: number;
    changed: number;
    added: number;
    removed: number;
  };
  /** Only entries whose status is not 'unchanged' are required to be listed. */
  comparisons: ComparisonEntry[];
  errors: VisualResultError[];
  reports: {
    /** Paths relative to the repo root; null when not produced. */
    html: string | null;
    json: string;
    markdown: string;
  };
}
