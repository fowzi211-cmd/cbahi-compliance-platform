import { describe, expect, it } from "vitest";
import { isOnboardingStep, nextOnboardingStep, stepAfter, withStepDone } from "./onboarding";

describe("onboarding progress", () => {
  it.each([
    [[], "facility"],
    [["facility"], "frameworks"],
    [["facility", "frameworks", "departments"], "applicability"],
    [["survey", "people", "departments", "applicability", "frameworks", "facility"], null],
    [["unknown"], "facility"],
  ])("next after %j → %s", (done, expected) => {
    expect(nextOnboardingStep(done)).toBe(expected);
  });

  it.each([
    ["facility", "frameworks"],
    ["people", "survey"],
    ["survey", null],
  ] as const)("step after %s → %s", (step, expected) => {
    expect(stepAfter(step)).toBe(expected);
  });

  it("records a step once, in wizard order, dropping unknown names", () => {
    expect(withStepDone(["survey", "bogus", "facility"], "frameworks")).toEqual([
      "facility",
      "frameworks",
      "survey",
    ]);
    expect(withStepDone(["facility"], "facility")).toEqual(["facility"]);
  });

  it("recognises step names from the URL", () => {
    expect(isOnboardingStep("departments")).toBe(true);
    expect(isOnboardingStep("settings")).toBe(false);
  });
});
