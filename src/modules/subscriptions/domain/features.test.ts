import { describe, expect, it } from "vitest";
import {
  effectiveTier,
  featureEnabled,
  features,
  parseOverrides,
  subscriptionProblem,
  tierMatrix,
  type SubscriptionTerms,
} from "./features";

const terms = (over: Partial<SubscriptionTerms> = {}): SubscriptionTerms => ({
  tier: "hybrid",
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  featureOverrides: {},
  ...over,
});

describe("effectiveTier", () => {
  it.each([
    ["platform stays platform", { tier: "platform" as const }, "2026-06-01", "platform"],
    ["hybrid within its term", {}, "2026-06-01", "hybrid"],
    ["hybrid on its first day", {}, "2026-01-01", "hybrid"],
    ["hybrid on its last day", {}, "2026-12-31", "hybrid"],
    ["hybrid before it starts", {}, "2025-12-31", "platform"],
    ["hybrid after it ends", {}, "2027-01-01", "platform"],
    ["hybrid with no end", { endsOn: null }, "2030-01-01", "hybrid"],
  ] as const)("%s", (_, over, today, expected) => {
    expect(effectiveTier(terms(over), today)).toBe(expected);
  });
});

describe("featureEnabled", () => {
  it("follows the tier matrix for every feature", () => {
    for (const feature of features) {
      expect(featureEnabled(terms(), feature, "2026-06-01")).toBe(tierMatrix.hybrid[feature]);
      expect(featureEnabled(terms({ tier: "platform" }), feature, "2026-06-01")).toBe(
        tierMatrix.platform[feature],
      );
    }
  });

  it.each([
    ["consultants only on Hybrid", {}, "consultantAssignment", true, "2026-06-01"],
    [
      "no consultants on Platform",
      { tier: "platform" as const },
      "consultantAssignment",
      false,
      "2026-06-01",
    ],
    ["no consultants once Hybrid ends", {}, "consultantAssignment", false, "2027-02-01"],
    [
      "struggle signal on Platform",
      { tier: "platform" as const },
      "struggleSignal",
      true,
      "2026-06-01",
    ],
    ["no struggle signal on Hybrid", {}, "struggleSignal", false, "2026-06-01"],
    [
      "an override turns a feature on",
      { tier: "platform" as const, featureOverrides: { gapAssessment: true } },
      "gapAssessment",
      true,
      "2026-06-01",
    ],
    [
      "an override turns a feature off",
      { featureOverrides: { consultantAssignment: false } },
      "consultantAssignment",
      false,
      "2026-06-01",
    ],
  ] as const)("%s", (_, over, feature, expected, today) => {
    expect(featureEnabled(terms(over), feature, today)).toBe(expected);
  });
});

describe("parseOverrides", () => {
  it.each([
    [null, {}],
    ["x", {}],
    [[true], {}],
    [
      { gapAssessment: true, struggleSignal: false },
      { gapAssessment: true, struggleSignal: false },
    ],
    [{ gapAssessment: "yes", unknown: true }, {}],
  ])("%j", (value, expected) => {
    expect(parseOverrides(value)).toEqual(expected);
  });
});

describe("subscriptionProblem", () => {
  it.each([
    ["2026-01-01", null, null],
    ["2026-01-01", "2026-01-01", null],
    ["2026-01-01", "2025-12-31", "endsBeforeStart"],
  ] as const)("%s to %s", (startsOn, endsOn, expected) => {
    expect(subscriptionProblem({ startsOn, endsOn })).toBe(expected);
  });
});
