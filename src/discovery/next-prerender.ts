import { readFile } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import type { NormalizedConfig, RouteDescriptor } from "../contracts/types.js";
import { VisualRegressionError } from "../contracts/error-codes.js";
import { describeRoutes, normalizeRoute } from "./route-name.js";

const metadata =
  /\/(?:robots\.txt|sitemap(?:-\d+)?\.xml|manifest\.webmanifest|favicon\.ico|icon(?:-\d+)?\.(?:png|jpg|jpeg|svg)|apple-icon(?:-\d+)?\.(?:png|jpg|jpeg))$/i;
export async function discoverRoutes(
  root: string,
  config: NormalizedConfig,
): Promise<RouteDescriptor[]> {
  const file = path.resolve(root, config.framework.manifestPath);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new VisualRegressionError(
      "ROUTE_DISCOVERY_FAILED",
      `Cannot read prerender manifest: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new VisualRegressionError(
      "ROUTE_DISCOVERY_FAILED",
      "Unknown prerender manifest shape",
    );
  const manifest = raw as Record<string, unknown>;
  const routesValue = manifest.routes;
  const dynamicRoutes = manifest.dynamicRoutes;
  const notFoundRoutes = manifest.notFoundRoutes;
  const plainRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const routeKeys = new Set([
    "allowHeader",
    "dataRoute",
    "experimentalBypassFor",
    "initialHeaders",
    "initialRevalidateSeconds",
    "initialStatus",
    "renderingMode",
    "srcRoute",
  ]);
  const dynamicKeys = new Set([
    "allowHeader",
    "dataRoute",
    "dataRouteRegex",
    "experimentalBypassFor",
    "fallback",
    "routeRegex",
  ]);
  const hasOnlyKeys = (
    value: unknown,
    allowed: ReadonlySet<string>,
  ): value is Record<string, unknown> =>
    plainRecord(value) && Object.keys(value).every((key) => allowed.has(key));
  if (
    ![3, 4].includes(manifest.version as number) ||
    !plainRecord(routesValue) ||
    Object.values(routesValue).some(
      (entry) => !hasOnlyKeys(entry, routeKeys),
    ) ||
    (dynamicRoutes !== undefined &&
      (!plainRecord(dynamicRoutes) ||
        Object.values(dynamicRoutes).some(
          (entry) => !hasOnlyKeys(entry, dynamicKeys),
        ))) ||
    (notFoundRoutes !== undefined &&
      (!Array.isArray(notFoundRoutes) ||
        notFoundRoutes.some((entry) => typeof entry !== "string")))
  )
    throw new VisualRegressionError(
      "ROUTE_DISCOVERY_FAILED",
      `Unsupported prerender manifest version or shape`,
    );
  const include = picomatch(config.routes.include, {
    nonegate: true,
    noext: false,
  });
  const exclude = config.routes.exclude.length
    ? picomatch(config.routes.exclude, { nonegate: true, noext: false })
    : () => false;
  const found = [...Object.keys(routesValue), ...config.routes.additional]
    .map(normalizeRoute)
    .filter(
      (route) =>
        !route.startsWith("/_") &&
        !metadata.test(route) &&
        include(route) &&
        !exclude(route),
    );
  const routes = [...new Set(found)].sort((a, b) => a.localeCompare(b, "en"));
  if (!routes.length)
    throw new VisualRegressionError(
      "ROUTE_DISCOVERY_FAILED",
      "No routes remain after filtering",
    );
  return describeRoutes(routes);
}
