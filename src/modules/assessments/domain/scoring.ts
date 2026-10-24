import { currentLevels, type ElementStatusRecord } from "./element-status";
import type { ScoreSource } from "./expiry";
import {
  countStandardsBelowMinimum,
  readinessStatus,
  type ReadinessReason,
  type ReadinessSettings,
  type ReadinessStatus,
} from "./readiness";
import {
  computeRollup,
  type Rollup,
  type RollupChapter,
  type RollupElement,
  type RollupSettings,
  type RollupStandard,
} from "./rollup";
import type { Scale } from "./scale";

export type ScoringContent = {
  chapters: readonly RollupChapter[];
  standards: readonly RollupStandard[];
  elements: readonly Omit<RollupElement, "levelCode">[];
};

/**
 * One series (internal or consultant) of a facility, as of `now`: each element's current
 * level from `ElementStatus` (expired ones count as unverified), rolled up, then judged for
 * readiness. This is what the dashboard and the daily snapshot will call.
 */
export function evaluateFacility(input: {
  content: ScoringContent;
  scale: Scale;
  rollup: RollupSettings;
  esr: { anyNotMetBlocksReadiness: boolean };
  readiness: ReadinessSettings;
  statuses: readonly ElementStatusRecord[];
  source: ScoreSource;
  overdueCapa: number;
  now: Date;
}): { rollup: Rollup; status: ReadinessStatus; reasons: ReadinessReason[] } {
  const levels = currentLevels(input.statuses, input.source, input.now);
  const rollup = computeRollup(
    {
      ...input.content,
      elements: input.content.elements.map((e) => ({ ...e, levelCode: levels.get(e.id) ?? null })),
    },
    input.scale,
    input.rollup,
  );
  const verdict = readinessStatus(
    {
      ...rollup.facility,
      overdueCapa: input.overdueCapa,
      standardsBelowMinimum: countStandardsBelowMinimum(
        rollup.standards.values(),
        input.readiness.minStandardScore,
      ),
    },
    input.readiness,
    input.esr,
  );
  return { rollup, ...verdict };
}
