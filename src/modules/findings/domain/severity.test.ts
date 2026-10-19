import { describe, expect, it } from "vitest";
import { findingSeverity } from "./severity";

describe("findingSeverity", () => {
  it.each([
    [{ isEsr: true, normalized: 0 }, "esr"],
    [{ isEsr: true, normalized: 0.5 }, "esr"],
    [{ isEsr: false, normalized: 0 }, "high"],
    [{ isEsr: false, normalized: 0.5 }, "medium"],
    [{ isEsr: false, normalized: 0.25 }, "medium"],
  ] as const)("%o → %s", (input, expected) => {
    expect(findingSeverity(input)).toBe(expected);
  });
});
