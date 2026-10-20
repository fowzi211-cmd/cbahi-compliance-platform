import { inScope } from "./assessment";
import { currentLevels, elementState, type ElementStatusRecord } from "./element-status";
import type { ScoreSource } from "./expiry";
import type { ReadinessSettings } from "./readiness";
import { computeRollup, type NodeScore, type RollupSettings } from "./rollup";
import type { Scale } from "./scale";
import { evaluateFacility, type ScoringContent } from "./scoring";

// The readiness overview and the nightly snapshot (ARCHITECTURE §4, "As built in M13"): one
// series of a facility as of `now`, broken down by chapter and by department, with the ESR
// elements and the elements nobody has verified recently.

export type ComplianceContent = {
  chapters: ScoringContent["chapters"];
  standards: ScoringContent["standards"];
  elements: readonly (ScoringContent["elements"][number] & {
    departmentTypes: readonly string[];
  })[];
};

export type EsrState = "met" | "notMet" | "unverified";
export type UnverifiedState = "expired" | "never";

export function complianceBreakdown(input: {
  content: ComplianceContent;
  scale: Scale;
  rollup: RollupSettings;
  esr: { anyNotMetBlocksReadiness: boolean };
  readiness: ReadinessSettings;
  statuses: readonly ElementStatusRecord[];
  source: ScoreSource;
  overdueCapa: number;
  departments: readonly { id: string; typeCode: string | null }[];
  now: Date;
}) {
  const verdict = evaluateFacility(input);
  const { rollup } = verdict;
  const levels = currentLevels(input.statuses, input.source, input.now);
  const records = new Map(
    input.statuses.filter((s) => s.source === input.source).map((s) => [s.elementId, s]),
  );

  // A department is scored on the elements its type is responsible for, exactly the scope
  // of a department self-assessment, so the two never disagree.
  const departments = input.departments.map((department) => {
    const elements = input.content.elements
      .filter((e) => inScope(e, department.typeCode))
      .map((e) => ({ ...e, levelCode: levels.get(e.id) ?? null }));
    const node: NodeScore =
      elements.length === 0
        ? { score: null, counted: 0, scored: 0, esrNotMet: 0, esrUnverified: 0 }
        : computeRollup({ ...input.content, elements }, input.scale, input.rollup).facility;
    return { departmentId: department.id, ...node };
  });

  const esr: { elementId: string; state: EsrState }[] = [];
  const unverified: { elementId: string; state: UnverifiedState; isEsr: boolean }[] = [];
  for (const element of input.content.elements) {
    const score = rollup.elements.get(element.id);
    // Not applicable, or scored N/A: nothing to show.
    if (score === null || score === undefined) continue;
    const level = levels.get(element.id) ?? null;
    if (level === null) {
      const state = elementState(records.get(element.id), input.now);
      unverified.push({
        elementId: element.id,
        state: state === "expired" ? "expired" : "never",
        isEsr: element.isEsr,
      });
    }
    if (element.isEsr) {
      esr.push({
        elementId: element.id,
        state: level === null ? "unverified" : score >= 1 - 1e-9 ? "met" : "notMet",
      });
    }
  }

  return {
    status: verdict.status,
    reasons: verdict.reasons,
    facility: rollup.facility,
    chapters: input.content.chapters.map((c) => ({
      chapterId: c.id,
      ...rollup.chapters.get(c.id)!,
    })),
    departments,
    esr,
    unverified,
    expired: unverified.filter((u) => u.state === "expired").length,
  };
}
export type ComplianceBreakdown = ReturnType<typeof complianceBreakdown>;
