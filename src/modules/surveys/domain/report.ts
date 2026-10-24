// The findings report of a locked mock survey (M15). Pure: the service gathers the survey,
// this decides what the report says, and the HTML template only lays it out.

export const reportLocales = ["ar", "en"] as const;
export type ReportLocale = (typeof reportLocales)[number];

export const findingSeverities = ["esr", "high", "medium", "low"] as const;
export type ReportSeverity = (typeof findingSeverities)[number];

export type ReportVerdict = "not_ready" | "at_risk" | "ready";
export type ReportVerdictReason =
  "esrNotMet" | "scoreBelowThreshold" | "standardBelowMinimum" | "nothingToScore";

export type ReportLevel = { code: string; labelAr: string | null; labelEn: string | null };

export type ReportElement = {
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  chapterCode: string;
  isEsr: boolean;
  levelCode: string;
  // Scored at the scale's top counting level.
  fullyMet: boolean;
  // Scored at a level that does not count (N/A for this survey).
  notApplicable: boolean;
  comment: string | null;
};

export type ReportFinding = {
  elementCode: string;
  titleAr: string | null;
  titleEn: string | null;
  severity: ReportSeverity;
  levelCode: string;
  statement: string | null;
};

export type ReportChapter = {
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  // 0..1, or null when nothing in the chapter counts.
  score: number | null;
  counted: number;
};

export type ReportInput = {
  score: number | null;
  scale: readonly ReportLevel[];
  chapters: readonly ReportChapter[];
  elements: readonly ReportElement[];
  findings: readonly ReportFinding[];
  readyScore: number;
  // The edition's per-standard minimum (null when it has none), and how many standards the
  // surveyor scored below it.
  minStandardScore: number | null;
  standardsBelowMinimum: number;
  // From the edition's roll-up settings: whether one ESR element not met fails readiness.
  esrBlocksReadiness: boolean;
};

const byCode = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * What the report concludes. The verdict applies rules 3 and 4 to what the surveyor saw
 * that day: an ESR element below full compliance fails it, then the score threshold.
 * Overdue CAPA items are left out on purpose; they are the facility's live state, not part
 * of the survey, and the dashboard already counts them.
 */
export function reportSummary(input: ReportInput) {
  const counted = input.elements.filter((e) => !e.notApplicable);
  const esrNotMet = counted.filter((e) => e.isEsr && !e.fullyMet);
  const reasons: ReportVerdictReason[] = [];
  if (esrNotMet.length > 0) reasons.push("esrNotMet");
  if (input.score === null) reasons.push("nothingToScore");
  else if (input.score < input.readyScore - 1e-9) reasons.push("scoreBelowThreshold");
  if (input.standardsBelowMinimum > 0) reasons.push("standardBelowMinimum");
  const verdict: ReportVerdict =
    esrNotMet.length > 0 && input.esrBlocksReadiness
      ? "not_ready"
      : reasons.length > 0
        ? "at_risk"
        : "ready";

  const levelCounts = input.scale.map((level) => ({
    ...level,
    count: input.elements.filter((e) => e.levelCode === level.code).length,
  }));
  const severityRank = (s: ReportSeverity) => findingSeverities.indexOf(s);
  const findings = [...input.findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) || byCode(a.elementCode, b.elementCode),
  );
  const findingCounts = findingSeverities.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  }));

  return {
    verdict,
    reasons,
    readyScore: input.readyScore,
    minStandardScore: input.minStandardScore,
    score: input.score,
    elementsScored: input.elements.length,
    elementsCounted: counted.length,
    esrNotMet: esrNotMet.map((e) => e.code).sort(byCode),
    levelCounts,
    findings,
    findingCounts,
    chapters: [...input.chapters].sort((a, b) => byCode(a.code, b.code)),
    elements: [...input.elements].sort((a, b) => byCode(a.code, b.code)),
  };
}
export type ReportSummary = ReturnType<typeof reportSummary>;

/** A file name that sorts by facility and date and is safe on every system. */
export function reportFileName(input: {
  frameworkCode: string;
  submittedOn: string;
  locale: ReportLocale;
}) {
  const code = input.frameworkCode.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `mock-survey-${code || "report"}-${input.submittedOn}-${input.locale}.pdf`;
}
