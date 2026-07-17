import { parse as parseCss } from "css-tree";
import { parse as parseCssSelector } from "css-what";
import { VisualRegressionError } from "../contracts/error-codes.js";
import type { NormalizedConfig, Project } from "../contracts/types.js";
import { assertSafeRelativePath } from "../platform/paths.js";
import { validateConfigShape } from "../contracts/validate.js";

const defaults: Project[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024, hasTouch: true },
  { name: "phone", width: 375, height: 812, hasTouch: true, isMobile: true },
];
const sortedUnique = (values: string[]): string[] =>
  [...new Set(values.map((x) => x.normalize("NFC")))].sort();
function glob(value: string): string {
  const normalized = value.normalize("NFC");
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    normalized.startsWith("!")
  )
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      `Invalid route glob: ${value}`,
    );
  return normalized;
}
function allowRule(value: string): string {
  if (["self", "data:", "blob:"].includes(value)) return value;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      `Invalid external request allowance: ${value}`,
    );
  }
}
function selector(value: string): string {
  const normalized = value.trim();
  try {
    if (
      !normalized ||
      value.length > 1024 ||
      /\0|(^|\s)(text|xpath|role|id|data-testid)=|>>>/.test(value) ||
      /[>+~]\s*(?:,|$)/.test(normalized)
    )
      throw new Error("unsupported selector syntax");
    parseCss(normalized, { context: "selectorList" });
    parseCssSelector(normalized);
  } catch {
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      `Invalid CSS selector: ${value.slice(0, 80)}`,
    );
  }
  return normalized;
}
function route(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").includes("..")
  )
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      `Invalid route: ${value}`,
    );
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}
export function normalizeConfig(value: unknown): NormalizedConfig {
  validateConfigShape(value);
  let origin: URL;
  try {
    origin = new URL(value.server.origin);
  } catch {
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "server.origin must be a URL",
    );
  }
  if (
    origin.protocol !== "http:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "server.origin must be a loopback HTTP origin with no path or credentials",
    );
  const projects = (value.projects ?? defaults)
    .map((p) => ({
      name: p.name,
      width: p.width,
      height: p.height,
      hasTouch: p.hasTouch ?? false,
      isMobile: p.isMobile ?? false,
      deviceScaleFactor: p.deviceScaleFactor ?? 1,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (
    new Set(projects.map((p) => p.name.toLowerCase())).size !== projects.length
  )
    throw new VisualRegressionError(
      "CONFIG_INVALID",
      "Duplicate project names",
    );
  const readinessPath = value.server.readinessPath ?? "/";
  if (
    !readinessPath.startsWith("/") ||
    readinessPath.startsWith("//") ||
    readinessPath.includes("\\") ||
    readinessPath.includes("\0")
  )
    throw new VisualRegressionError("CONFIG_INVALID", "Invalid readiness path");
  return {
    framework: {
      type: "next-prerender",
      manifestPath: assertSafeRelativePath(
        value.framework.manifestPath ?? ".next/prerender-manifest.json",
        "manifest path",
      ),
    },
    commands: { ...value.commands },
    server: {
      origin: origin.origin,
      readinessPath,
      startupTimeoutMs: value.server.startupTimeoutMs ?? 120000,
    },
    routes: {
      include: sortedUnique((value.routes?.include ?? ["/**"]).map(glob)),
      exclude: sortedUnique((value.routes?.exclude ?? []).map(glob)),
      additional: sortedUnique((value.routes?.additional ?? []).map(route)),
    },
    clock: {
      environmentVariable:
        value.clock?.environmentVariable ?? "VISUAL_TEST_DATE",
    },
    projects,
    capture: {
      colorScheme: value.capture?.colorScheme ?? "light",
      locale: value.capture?.locale ?? "en-US",
      timezoneId: value.capture?.timezoneId ?? "UTC",
      reducedMotion: value.capture?.reducedMotion ?? "reduce",
      fontChecks: sortedUnique(
        (value.capture?.fontChecks ?? []).map((x) => {
          const trimmed = x.trim();
          if (!trimmed)
            throw new VisualRegressionError(
              "CONFIG_INVALID",
              "Font checks cannot be empty",
            );
          return trimmed;
        }),
      ),
      readinessSelectors: sortedUnique(
        (value.capture?.readinessSelectors ?? []).map(selector),
      ),
      masks: sortedUnique((value.capture?.masks ?? []).map(selector)),
      externalRequests: {
        default: "block",
        allow: sortedUnique(
          (
            value.capture?.externalRequests?.allow ?? ["self", "data:", "blob:"]
          ).map(allowRule),
        ),
      },
      screenshot: {
        fullPage: true,
        threshold: value.capture?.screenshot?.threshold ?? 0.2,
      },
      navigationTimeoutMs: value.capture?.navigationTimeoutMs ?? 30000,
      stabilizationTimeoutMs: value.capture?.stabilizationTimeoutMs ?? 30000,
      maxScrollPasses: value.capture?.maxScrollPasses ?? 100,
      maxDocumentHeight: value.capture?.maxDocumentHeight ?? 50000,
      maxResources: value.capture?.maxResources ?? 1000,
    },
  };
}
