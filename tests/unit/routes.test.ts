import { describe, expect, it } from "vitest";
import {
  describeRoutes,
  normalizeRoute,
  routeFileName,
} from "../../src/discovery/route-name.js";

describe("route normalization and portable names", () => {
  it("uses the fixed root name and bounded hashed names", () => {
    expect(routeFileName("/")).toBe("home.png");
    const name = routeFileName("/café/hello world");
    expect(name).toMatch(/^cafe-hello-world-[a-f0-9]{16}\.png$/);
    expect(name.length).toBeLessThanOrEqual(201);
  });
  it("protects Windows reserved names and distinguishes hostile Unicode", () => {
    expect(routeFileName("/con")).toMatch(/^route-con-/);
    expect(routeFileName("/é")).not.toBe(routeFileName("/e"));
  });
  it.each(["relative", "/../x", "/[slug]", "/x?query=1", "/x#hash", "/x\\y"])(
    "rejects unsafe or unresolved route %s",
    (route) => {
      expect(() => normalizeRoute(route)).toThrow();
    },
  );
  it("sort-independent collision checks preserve routes", () => {
    expect(describeRoutes(["/A", "/a"]).map((item) => item.route)).toEqual([
      "/A",
      "/a",
    ]);
  });
});
