import { findLevel, type Scale } from "./scale";

// Rule 1 and the ESR part of rule 3 (ARCHITECTURE §4): what makes one element score valid
// before it can be saved.

export type ElementScoreInput = {
  levelCode: string;
  isEsr: boolean;
  // Whether the element applies to the facility (framework rule plus facility decision, M5).
  applicable: boolean;
  evidenceCount: number;
  comment: string | null;
};

export type EsrConfig = {
  allowedLevels: readonly string[];
  anyNotMetBlocksReadiness: boolean;
};

export type ElementScoreProblem =
  | "unknownLevel"
  | "elementNotApplicable"
  | "esrLevelNotAllowed"
  | "evidenceRequired"
  | "commentRequired";

/**
 * Every problem with a score, in the order a scorer should fix them. An element the
 * facility ruled out cannot be scored at all: "not applicable" is decided once, with a
 * justification, not re-decided in each assessment.
 */
export function elementScoreProblems(
  input: ElementScoreInput,
  scale: Scale,
  esr: EsrConfig,
): ElementScoreProblem[] {
  const level = findLevel(scale, input.levelCode);
  if (!level) return ["unknownLevel"];
  if (!input.applicable) return ["elementNotApplicable"];
  const problems: ElementScoreProblem[] = [];
  // ESR elements are pass/fail: partial compliance with a safety requirement is not
  // compliance, so PM (and anything else outside the allowed list) is refused.
  if (input.isEsr && !esr.allowedLevels.includes(level.code)) problems.push("esrLevelNotAllowed");
  // Anti-decoration: a claim of compliance needs something a surveyor can look at.
  if (level.requiresEvidence && input.evidenceCount < 1) problems.push("evidenceRequired");
  // An element-level N/A ("not this time": the service was suspended, no case occurred)
  // must say why, or it reads as skipping the hard question.
  if (!level.countsInDenominator && !(input.comment ?? "").trim()) {
    problems.push("commentRequired");
  }
  return problems;
}
