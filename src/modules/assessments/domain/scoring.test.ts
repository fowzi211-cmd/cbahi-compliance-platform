import { describe, expect, it } from "vitest";
import { statusUpdatesOnSubmit, type ElementStatusRecord } from "./element-status";
import { defaultReadinessSettings } from "./readiness";
import type { RollupSettings } from "./rollup";
import { evaluateFacility, type ScoringContent } from "./scoring";
import { testScale } from "./test-scale";

// A small facility followed through time: scored, then left alone until scores expire.
const content: ScoringContent = {
  chapters: [{ id: "C" }],
  standards: [{ id: "S", chapterId: "C", weight: 1 }],
  elements: [
    { id: "esr", standardId: "S", weight: 1, isEsr: true, applicable: true },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `e${i}`,
      standardId: "S",
      weight: 1,
      isEsr: false,
      applicable: true,
    })),
  ],
};
const rollup: RollupSettings = {
  standard: { method: "weighted_average", metThreshold: 1, pmThreshold: 0.5 },
  chapter: { method: "weighted_average" },
  facility: { method: "weighted_average" },
};
const scoredAt = new Date("2026-10-01T08:00:00Z");

function submit(levels: Record<string, string>, current: ElementStatusRecord[] = []) {
  return statusUpdatesOnSubmit({
    source: "internal",
    current,
    scores: Object.entries(levels).map(([elementId, levelCode]) => ({
      elementId,
      levelCode,
      scoreId: `${elementId}-${levelCode}`,
      scoredAt,
    })),
  });
}

const evaluate = (
  statuses: ElementStatusRecord[],
  now: Date,
  overdueCapa = 0,
  readiness = defaultReadinessSettings,
) =>
  evaluateFacility({
    content,
    scale: testScale,
    rollup,
    esr: { anyNotMetBlocksReadiness: true },
    readiness,
    statuses,
    source: "internal",
    overdueCapa,
    now,
  });

const allMet = Object.fromEntries(content.elements.map((e) => [e.id, "MET"]));

describe("evaluateFacility", () => {
  it("is not ready before anything is scored", () => {
    const result = evaluate([], scoredAt);
    expect(result.rollup.facility).toMatchObject({ score: 0, esrUnverified: 1 });
    expect(result.status).toBe("not_ready");
  });

  it("is ready when everything is met and current", () => {
    const result = evaluate(submit(allMet), new Date("2026-10-19T00:00:00Z"));
    expect(result).toMatchObject({ status: "ready", reasons: [] });
    expect(result.rollup.facility.score).toBe(1);
  });

  it("is not ready at 90% when the ESR element is not met", () => {
    const result = evaluate(submit({ ...allMet, esr: "NM" }), scoredAt);
    expect(result.rollup.facility.score).toBeCloseTo(0.9);
    expect(result).toMatchObject({ status: "not_ready", reasons: ["esrNotMet"] });
  });

  it("falls to not ready when the scores expire 90 days later", () => {
    const statuses = submit(allMet);
    expect(evaluate(statuses, new Date("2026-12-30T07:59:59Z")).status).toBe("ready");
    const expired = evaluate(statuses, new Date("2026-12-30T08:00:00Z"));
    expect(expired.rollup.facility).toMatchObject({ score: 0, scored: 0, esrUnverified: 1 });
    expect(expired.reasons).toEqual(["esrUnverified", "scoreBelowThreshold"]);
  });

  it("is at risk with too many overdue CAPA items", () => {
    expect(evaluate(submit(allMet), scoredAt, 6)).toMatchObject({
      status: "at_risk",
      reasons: ["overdueCapa"],
    });
  });

  it("applies the edition's pass mark and per-standard minimum", () => {
    // Six of ten elements met: 60% overall, and the only standard scores 60% too.
    const levels = { ...allMet, e5: "NM", e6: "NM", e7: "NM", e8: "NM" };
    const settings = (readyScore: number, minStandardScore: number | null) => ({
      ...defaultReadinessSettings,
      readyScore,
      minStandardScore,
    });
    expect(evaluate(submit(levels), scoredAt, 0, settings(0.6, 0.5)).status).toBe("ready");
    expect(evaluate(submit(levels), scoredAt, 0, settings(0.6, 0.75))).toMatchObject({
      status: "at_risk",
      reasons: ["standardBelowMinimum"],
    });
  });

  it("ignores the consultant series when judging the internal one", () => {
    const consultant = statusUpdatesOnSubmit({
      source: "consultant",
      current: [],
      scores: [{ elementId: "esr", scoreId: "c", levelCode: "NM", scoredAt }],
    });
    expect(evaluate([...submit(allMet), ...consultant], scoredAt).status).toBe("ready");
  });
});
