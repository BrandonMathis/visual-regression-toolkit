import { describe, expect, it } from "vitest";
import { exitCodeForStatus } from "../../src/cli/exit-code.js";
describe("CLI exit mapping", () => {
  it("maps only complete visual differences to exit 2", () => {
    expect(exitCodeForStatus("pass")).toBe(0);
    expect(exitCodeForStatus("infrastructure-error")).toBe(1);
    expect(exitCodeForStatus("visual-diff")).toBe(2);
  });
});
