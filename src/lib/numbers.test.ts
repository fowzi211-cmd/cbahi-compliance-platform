import { describe, expect, it } from "vitest";
import { formatPercent } from "./numbers";

describe("formatPercent", () => {
  it.each([
    [0, "0%"],
    [0.25, "25%"],
    [0.756, "76%"],
    [0.995, "100%"],
    [1, "100%"],
    [1.2, "100%"],
    [-0.1, "0%"],
  ])("%d → %s", (input, expected) => {
    expect(formatPercent(input)).toBe(expected);
  });
});
