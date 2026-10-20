import { describe, expect, it } from "vitest";
import { complianceBreakdown, type ComplianceContent } from "./compliance";
import type { ElementStatusRecord } from "./element-status";
import { defaultReadinessSettings } from "./readiness";
import type { RollupSettings } from "./rollup";
import { testScale } from "./test-scale";

// Two chapters; the pharmacy owns e1 and e2 (e1 is ESR), the lab owns e3, and e4 is a
// facility-wide element. e5 does not apply to the facility.
const content: ComplianceContent = {
  chapters: [{ id: "C1" }, { id: "C2" }],
  standards: [
    { id: "S1", chapterId: "C1", weight: 1 },
    { id: "S2", chapterId: "C2", weight: 1 },
  ],
  elements: [
    {
      id: "e1",
      standardId: "S1",
      weight: 1,
      isEsr: true,
      applicable: true,
      departmentTypes: ["pharmacy"],
    },
    {
      id: "e2",
      standardId: "S1",
      weight: 1,
      isEsr: false,
      applicable: true,
      departmentTypes: ["pharmacy"],
    },
    {
      id: "e3",
      standardId: "S2",
      weight: 1,
      isEsr: false,
      applicable: true,
      departmentTypes: ["lab"],
    },
    { id: "e4", standardId: "S2", weight: 1, isEsr: false, applicable: true, departmentTypes: [] },
    {
      id: "e5",
      standardId: "S2",
      weight: 1,
      isEsr: true,
      applicable: false,
      departmentTypes: ["lab"],
    },
  ],
};
const rollup: RollupSettings = {
  standard: { method: "weighted_average", metThreshold: 1, pmThreshold: 0.5 },
  chapter: { method: "weighted_average" },
  facility: { method: "weighted_average" },
};
const now = new Date("2026-10-20T08:00:00Z");
const departments = [
  { id: "pharmacy", typeCode: "pharmacy" },
  { id: "lab", typeCode: "lab" },
  { id: "admin", typeCode: null },
];

function status(
  elementId: string,
  levelCode: string,
  expiresAt: Date | null = new Date("2026-12-01T00:00:00Z"),
  source: "internal" | "consultant" = "internal",
): ElementStatusRecord {
  return {
    elementId,
    source,
    scoreId: `${elementId}-${source}`,
    levelCode,
    verifiedAt: new Date("2026-09-01T00:00:00Z"),
    expiresAt,
  };
}

const breakdown = (
  statuses: ElementStatusRecord[],
  source: "internal" | "consultant" = "internal",
) =>
  complianceBreakdown({
    content,
    scale: testScale,
    rollup,
    esr: { anyNotMetBlocksReadiness: true },
    readiness: defaultReadinessSettings,
    statuses,
    source,
    overdueCapa: 0,
    departments,
    now,
  });

describe("complianceBreakdown", () => {
  it("scores nothing verified as 0 and lists every applicable element as never verified", () => {
    const result = breakdown([]);
    expect(result.status).toBe("not_ready");
    expect(result.facility).toMatchObject({ score: 0, counted: 4, scored: 0, esrUnverified: 1 });
    expect(result.esr).toEqual([{ elementId: "e1", state: "unverified" }]);
    expect(result.unverified.map((u) => [u.elementId, u.state, u.isEsr])).toEqual([
      ["e1", "never", true],
      ["e2", "never", false],
      ["e3", "never", false],
      ["e4", "never", false],
    ]);
    expect(result.expired).toBe(0);
  });

  it("breaks the score down by chapter and by the department that owns each element", () => {
    const result = breakdown([
      status("e1", "MET"),
      status("e2", "PM"),
      status("e3", "NM"),
      status("e4", "MET"),
    ]);
    expect(result.facility.score).toBeCloseTo(0.625);
    expect(result.chapters).toEqual([
      expect.objectContaining({ chapterId: "C1", score: 0.75, counted: 2, scored: 2 }),
      expect.objectContaining({ chapterId: "C2", score: 0.5, counted: 2, scored: 2 }),
    ]);
    expect(result.departments).toEqual([
      expect.objectContaining({ departmentId: "pharmacy", score: 0.75, counted: 2 }),
      // The ESR element that does not apply is left out of the lab's score.
      expect.objectContaining({ departmentId: "lab", score: 0, counted: 1 }),
      // A department with no type is responsible for nothing.
      { departmentId: "admin", score: null, counted: 0, scored: 0, esrNotMet: 0, esrUnverified: 0 },
    ]);
    expect(result.esr).toEqual([{ elementId: "e1", state: "met" }]);
    expect(result.unverified).toEqual([]);
  });

  it("marks an ESR element scored below full compliance as not met", () => {
    const result = breakdown([status("e1", "PM")]);
    expect(result.esr).toEqual([{ elementId: "e1", state: "notMet" }]);
    expect(result.reasons).toContain("esrNotMet");
  });

  it("tells an expired score from one never given", () => {
    const result = breakdown([
      status("e1", "MET", new Date("2026-10-01T00:00:00Z")),
      status("e2", "MET"),
    ]);
    expect(result.esr).toEqual([{ elementId: "e1", state: "unverified" }]);
    expect(result.unverified.map((u) => [u.elementId, u.state])).toEqual([
      ["e1", "expired"],
      ["e3", "never"],
      ["e4", "never"],
    ]);
    expect(result.expired).toBe(1);
  });

  it("leaves out an element scored N/A this time", () => {
    const result = breakdown([status("e4", "NA")]);
    expect(result.unverified.map((u) => u.elementId)).toEqual(["e1", "e2", "e3"]);
    expect(result.facility.counted).toBe(3);
  });

  it("reads one series only: consultant scores never fill internal gaps", () => {
    const consultant = [
      status("e1", "MET", null, "consultant"),
      status("e2", "MET", null, "consultant"),
    ];
    expect(breakdown(consultant).facility.scored).toBe(0);
    const result = breakdown(consultant, "consultant");
    expect(result.facility).toMatchObject({ scored: 2, score: 0.5 });
    expect(result.esr).toEqual([{ elementId: "e1", state: "met" }]);
  });
});
