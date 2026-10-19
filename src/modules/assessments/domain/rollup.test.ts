import { describe, expect, it } from "vitest";
import {
  combine,
  computeRollup,
  elementScore,
  rollupSettingsFrom,
  type RollupElement,
  type RollupSettings,
} from "./rollup";
import { testScale } from "./test-scale";

const thresholds = { metThreshold: 1, pmThreshold: 0.5 };
const c = (score: number | null, weight = 1) => ({ score, weight });

describe("combine", () => {
  it.each([
    ["weighted_average, equal weights", "weighted_average", [c(1), c(0.5), c(0)], 0.5],
    ["weighted_average, weighted", "weighted_average", [c(1, 3), c(0, 1)], 0.75],
    ["weighted_average skips no-score children", "weighted_average", [c(1), c(null)], 1],
    ["weighted_average skips weight 0", "weighted_average", [c(1), c(0, 0)], 1],
    ["all_must_meet, all met", "all_must_meet", [c(1), c(1)], 1],
    ["all_must_meet, one partial", "all_must_meet", [c(1), c(0.5)], 0],
    ["all_must_meet ignores N/A children", "all_must_meet", [c(1), c(null)], 1],
    ["threshold, all met", "threshold", [c(1), c(1)], 1],
    ["threshold, half met → partial", "threshold", [c(1), c(0)], 0.5],
    ["threshold, PM does not count as met", "threshold", [c(1), c(0.5), c(0.5)], 0],
    ["threshold, weighted share", "threshold", [c(1, 3), c(0, 1)], 0.5],
    ["nothing counts", "weighted_average", [c(null), c(1, 0)], null],
    ["no children", "all_must_meet", [], null],
  ] as const)("%s", (_, method, children, expected) => {
    expect(combine(children, method, thresholds)).toBe(expected);
  });

  it.each([
    [0.8, 0.4, [c(1), c(1), c(1), c(1), c(0)], 1],
    [0.9, 0.4, [c(1), c(1), c(1), c(1), c(0)], 0.5],
    [0.9, 0.85, [c(1), c(1), c(1), c(1), c(0)], 0],
  ])("threshold met %s / partial %s", (metThreshold, pmThreshold, children, expected) => {
    expect(combine(children, "threshold", { metThreshold, pmThreshold })).toBe(expected);
  });
});

const element = (over: Partial<RollupElement> = {}): RollupElement => ({
  id: "e",
  standardId: "s",
  weight: 1,
  isEsr: false,
  applicable: true,
  levelCode: "MET",
  ...over,
});

describe("elementScore", () => {
  it.each([
    ["MET", element(), 1],
    ["PM", element({ levelCode: "PM" }), 0.5],
    ["NM", element({ levelCode: "NM" }), 0],
    ["N/A this time", element({ levelCode: "NA" }), null],
    ["never scored or expired counts as 0", element({ levelCode: null }), 0],
    ["does not apply to the facility", element({ applicable: false, levelCode: null }), null],
  ])("%s", (_, input, expected) => {
    expect(elementScore(input, testScale)).toBe(expected);
  });

  it("refuses a level the scale does not have", () => {
    expect(() => elementScore(element({ levelCode: "GOLD" }), testScale)).toThrow(/GOLD/);
  });
});

const average: RollupSettings = {
  standard: { method: "weighted_average", metThreshold: 1, pmThreshold: 0.5 },
  chapter: { method: "weighted_average" },
  facility: { method: "weighted_average" },
};

// Two chapters. A has two standards (weights 1 and 2), B has one standard of weight 1.
const content = (
  levels: Record<string, string | null>,
  over: Record<string, Partial<RollupElement>> = {},
) => ({
  chapters: [{ id: "A" }, { id: "B" }],
  standards: [
    { id: "A1", chapterId: "A", weight: 1 },
    { id: "A2", chapterId: "A", weight: 2 },
    { id: "B1", chapterId: "B", weight: 1 },
  ],
  elements: [
    element({ id: "a1x", standardId: "A1", isEsr: true }),
    element({ id: "a1y", standardId: "A1" }),
    element({ id: "a2x", standardId: "A2" }),
    element({ id: "b1x", standardId: "B1", isEsr: true }),
    element({ id: "b1y", standardId: "B1" }),
  ].map((e) => ({ ...e, levelCode: e.id in levels ? levels[e.id]! : "MET", ...over[e.id] })),
});

describe("computeRollup", () => {
  it("is 100% when everything applicable is met", () => {
    const r = computeRollup(content({}), testScale, average);
    expect(r.facility).toEqual({ score: 1, counted: 5, scored: 5, esrNotMet: 0, esrUnverified: 0 });
  });

  it("weighs standards within a chapter and chapters by their standards' weight", () => {
    // A1 = (1 + 0.5)/2 = 0.75; A2 = 0; chapter A = (0.75·1 + 0·2)/3 = 0.25.
    // B1 = 1; chapter B = 1. Facility = (0.25·3 + 1·1)/4 = 0.4375.
    const r = computeRollup(content({ a1y: "PM", a2x: "NM" }), testScale, average);
    expect(r.standards.get("A1")!.score).toBe(0.75);
    expect(r.standards.get("A2")!.score).toBe(0);
    expect(r.chapters.get("A")!.score).toBe(0.25);
    expect(r.chapters.get("B")!.score).toBe(1);
    expect(r.facility.score).toBe(0.4375);
  });

  it("leaves N/A and ruled-out elements out of the denominator", () => {
    const r = computeRollup(
      content({ a2x: "NA", b1y: "NM" }, { a1y: { applicable: false, levelCode: null } }),
      testScale,
      average,
    );
    expect(r.elements.get("a1y")).toBeNull();
    expect(r.standards.get("A2")!.score).toBeNull();
    // Chapter A has only A1 left (score 1, weight 1); B1 = 0.5.
    expect(r.chapters.get("A")).toMatchObject({ score: 1, counted: 1 });
    expect(r.facility).toMatchObject({ score: 0.75, counted: 3, scored: 3 });
  });

  it("counts unverified elements as 0 and reports them", () => {
    const r = computeRollup(content({ a2x: null, b1x: null }), testScale, average);
    expect(r.facility).toMatchObject({ counted: 5, scored: 3, esrUnverified: 1, esrNotMet: 0 });
    expect(r.standards.get("A2")!.score).toBe(0);
  });

  it("counts ESR elements below full compliance as not met", () => {
    const r = computeRollup(content({ a1x: "NM" }), testScale, average);
    expect(r.facility.esrNotMet).toBe(1);
    expect(r.chapters.get("B")!.esrNotMet).toBe(0);
  });

  it("applies all_must_meet at standard level", () => {
    const settings = {
      ...average,
      standard: { ...average.standard, method: "all_must_meet" as const },
    };
    const r = computeRollup(content({ a1y: "PM" }), testScale, settings);
    expect(r.standards.get("A1")!.score).toBe(0);
    // Chapter A = (0·1 + 1·2)/3.
    expect(r.chapters.get("A")!.score).toBeCloseTo(2 / 3);
  });

  it("applies threshold at standard level with the edition's thresholds", () => {
    const settings: RollupSettings = {
      ...average,
      standard: { method: "threshold", metThreshold: 1, pmThreshold: 0.5 },
    };
    const r = computeRollup(content({ a1y: "NM" }), testScale, settings);
    expect(r.standards.get("A1")!.score).toBe(0.5);
  });

  it("applies all_must_meet at facility level", () => {
    const settings = { ...average, facility: { method: "all_must_meet" as const } };
    expect(computeRollup(content({}), testScale, settings).facility.score).toBe(1);
    expect(computeRollup(content({ b1y: "PM" }), testScale, settings).facility.score).toBe(0);
  });

  it("scores a slice (one department's elements) the same way", () => {
    const all = content({ a1y: "NM" });
    const slice = { ...all, elements: all.elements.filter((e) => e.standardId === "A1") };
    const r = computeRollup(slice, testScale, average);
    expect(r.facility).toMatchObject({ score: 0.5, counted: 2 });
    expect(r.chapters.get("B")!.score).toBeNull();
  });

  it("has no score when nothing applies", () => {
    const none = content(
      {},
      Object.fromEntries(
        ["a1x", "a1y", "a2x", "b1x", "b1y"].map((id) => [id, { applicable: false }]),
      ),
    );
    expect(computeRollup(none, testScale, average).facility).toEqual({
      score: null,
      counted: 0,
      scored: 0,
      esrNotMet: 0,
      esrUnverified: 0,
    });
  });
});

describe("rollupSettingsFrom", () => {
  it("maps the stored snake_case config", () => {
    expect(
      rollupSettingsFrom({
        standard: { method: "threshold", met_threshold: 0.9, pm_threshold: 0.6 },
        chapter: { method: "weighted_average" },
        facility: { method: "all_must_meet" },
      }),
    ).toEqual({
      standard: { method: "threshold", metThreshold: 0.9, pmThreshold: 0.6 },
      chapter: { method: "weighted_average" },
      facility: { method: "all_must_meet" },
    });
  });
});
