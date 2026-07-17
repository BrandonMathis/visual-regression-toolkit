import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../src/config/normalize.js";
import { hashVisualContract } from "../../src/config/contract.js";
import { rawConfig } from "../helpers.js";

describe("configuration normalization and contract hashing", () => {
  it("materializes deterministic defaults", () => {
    const config = normalizeConfig(rawConfig);
    expect(config.projects.map((project) => project.name)).toEqual([
      "desktop",
      "phone",
      "tablet",
    ]);
    expect(config.capture.externalRequests.allow).toEqual([
      "blob:",
      "data:",
      "self",
    ]);
    expect(config.framework.manifestPath).toBe(".next/prerender-manifest.json");
  });
  it("rejects unknown keys and unsafe semantic values", () => {
    expect(() => normalizeConfig({ ...rawConfig, surprise: true })).toThrow(
      /additional properties/i,
    );
    expect(() =>
      normalizeConfig({
        ...rawConfig,
        server: { origin: "https://example.com" },
      }),
    ).toThrow(/loopback/i);
    expect(() =>
      normalizeConfig({
        ...rawConfig,
        framework: { type: "next-prerender", manifestPath: "../manifest.json" },
      }),
    ).toThrow(/unsafe/i);
    expect(() =>
      normalizeConfig({ ...rawConfig, routes: { include: ["../**"] } }),
    ).toThrow(/glob/i);
    expect(() =>
      normalizeConfig({ ...rawConfig, capture: { masks: ["xpath=//body"] } }),
    ).toThrow(/selector/i);
    for (const invalid of ["[", "div >", "div + + span"])
      expect(() =>
        normalizeConfig({ ...rawConfig, capture: { masks: [invalid] } }),
      ).toThrow(/selector/i);
    expect(() =>
      normalizeConfig({
        ...rawConfig,
        routes: { additional: ["//evil.test"] },
      }),
    ).toThrow(/route/i);
  });
  it("normalizes set-like order before hashing", () => {
    const first = normalizeConfig({
      ...rawConfig,
      routes: { include: ["/b/**", "/a/**"] },
      capture: { externalRequests: { allow: ["self", "data:"] } },
    });
    const second = normalizeConfig({
      ...rawConfig,
      routes: { include: ["/a/**", "/b/**"] },
      capture: { externalRequests: { allow: ["data:", "self"] } },
    });
    expect(hashVisualContract(first)).toBe(hashVisualContract(second));
  });
  it("changes the hash for pixel-affecting and command settings", () => {
    const first = normalizeConfig(rawConfig);
    const viewport = normalizeConfig({
      ...rawConfig,
      projects: [{ name: "desktop", width: 1200, height: 900 }],
    });
    const command = normalizeConfig({
      ...rawConfig,
      commands: { ...rawConfig.commands, build: "npm run other-build" },
    });
    expect(hashVisualContract(viewport)).not.toBe(hashVisualContract(first));
    expect(hashVisualContract(command)).not.toBe(hashVisualContract(first));
  });
});
