import { describe, expect, it } from "vitest";
import { normalizedValue, scaleMaximum, type Scale } from "./scale";
import { testScale } from "./test-scale";

describe("normalizedValue", () => {
  it.each([
    ["MET", 1],
    ["PM", 0.5],
    ["NM", 0],
    ["NA", null],
  ])("%s on the default scale → %s", (code, expected) => {
    expect(
      normalizedValue(
        testScale.find((l) => l.code === code)!,
        testScale,
      ),
    ).toBe(expected);
  });

  it("measures against the scale's own maximum", () => {
    const scale: Scale = [
      {
        code: "FULL",
        value: 2,
        countsInDenominator: true,
        requiresEvidence: true,
        generatesFinding: false,
      },
      {
        code: "PART",
        value: 1,
        countsInDenominator: true,
        requiresEvidence: true,
        generatesFinding: true,
      },
      {
        code: "NONE",
        value: 0,
        countsInDenominator: true,
        requiresEvidence: false,
        generatesFinding: true,
      },
    ];
    expect(scaleMaximum(scale)).toBe(2);
    expect(scale.map((l) => normalizedValue(l, scale))).toEqual([1, 0.5, 0]);
  });

  it("is 0 on a degenerate scale with no positive level", () => {
    const flat: Scale = [{ ...testScale[2]! }];
    expect(normalizedValue(flat[0]!, flat)).toBe(0);
  });
});
