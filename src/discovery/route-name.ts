import { createHash } from "node:crypto";
import { VisualRegressionError } from "../contracts/error-codes.js";

export function normalizeRoute(input: string): string {
  let decoded: string;
  try {
    decoded = decodeURI(input).normalize("NFC");
  } catch {
    throw new VisualRegressionError(
      "ROUTE_DISCOVERY_FAILED",
      `Invalid encoded route: ${input}`,
    );
  }
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.split("/").includes("..") ||
    /\[[^\]]+\]|:[A-Za-z]/.test(decoded)
  )
    throw new VisualRegressionError(
      "ROUTE_DISCOVERY_FAILED",
      `Unsafe or unresolved route: ${input}`,
    );
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
}
export function routeFileName(route: string): string {
  const normalized = normalizeRoute(route);
  if (normalized === "/") return "home.png";
  const slug =
    normalized
      .slice(1)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 180) || "route";
  const safeSlug = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)
    ? `route-${slug}`
    : slug;
  const suffix = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
  return `${safeSlug}-${suffix}.png`;
}
export function describeRoutes(
  routes: string[],
): Array<{ route: string; fileName: string }> {
  const described = routes.map((route) => ({
    route: normalizeRoute(route),
    fileName: routeFileName(route),
  }));
  const names = new Set<string>();
  for (const item of described) {
    const folded = item.fileName.normalize("NFC").toLowerCase();
    if (names.has(folded))
      throw new VisualRegressionError(
        "ROUTE_DISCOVERY_FAILED",
        `Screenshot filename collision for ${item.route}`,
      );
    names.add(folded);
  }
  return described;
}
