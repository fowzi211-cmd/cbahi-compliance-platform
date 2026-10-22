import type { Program } from "./import-format";

// Which frameworks and elements apply to a facility (ARCHITECTURE §3.2, M5).

/**
 * The accreditation programmes usually relevant to each facility type, used to pre-select
 * frameworks in onboarding. A suggestion only: the owner confirms the list, because a
 * facility's licence (not its label) decides which programme it is surveyed under.
 */
const programsByFacilityType: Record<string, readonly Program[]> = {
  hospital: ["hospital"],
  polyclinic: ["ambulatory"],
  primary_care: ["primary"],
  dental: ["dental", "ambulatory"],
  laboratory: ["lab"],
  home_care: ["home_health"],
  seasonal_hospital: ["seasonal_hospital"],
  other: [],
};

export function suggestedPrograms(facilityType: string): readonly Program[] {
  return programsByFacilityType[facilityType] ?? [];
}

export type ApplicabilityOverride = { applicable: boolean; justification: string | null };

export type ApplicabilityReason =
  // Applies: the framework names no facility types, or names this one.
  | "applies"
  // Does not apply: the framework limits the element to other facility types.
  | "otherFacilityType"
  // The facility's own decision, recorded with a justification.
  | "markedNotApplicable"
  | "markedApplicable";

export type Applicability = { applicable: boolean; reason: ApplicabilityReason };

/**
 * The framework's facility-type rule first, then the facility's own override. An override
 * always wins: a polyclinic that runs a service the framework ties to hospitals can bring
 * the element in, and any facility can rule one out with a justification.
 */
export function resolveApplicability(
  element: { facilityTypes: readonly string[] },
  facilityType: string,
  override: ApplicabilityOverride | null,
): Applicability {
  if (override) {
    return {
      applicable: override.applicable,
      reason: override.applicable ? "markedApplicable" : "markedNotApplicable",
    };
  }
  const byType = element.facilityTypes.length === 0 || element.facilityTypes.includes(facilityType);
  return { applicable: byType, reason: byType ? "applies" : "otherFacilityType" };
}

export const justificationLimits = { min: 10, max: 1000 } as const;

/**
 * A "not applicable" decision is only credible with a reason a surveyor can check ("we do
 * not provide sedation", not "n/a"). Returns the problem, or null when the text is fine.
 */
export function justificationProblem(text: string | null): "tooShort" | "tooLong" | null {
  const value = (text ?? "").trim();
  if (value.length < justificationLimits.min) return "tooShort";
  if (value.length > justificationLimits.max) return "tooLong";
  return null;
}

export type ApplicabilityDecision = { applicable: boolean; justification: string | null };

export type ApplicabilityChange =
  | { kind: "clear" }
  | { kind: "set"; applicable: boolean; justification: string | null }
  | { kind: "invalid"; problem: "tooShort" | "tooLong" };

/**
 * What to store for a decision. A decision that matches the framework's own rule removes the
 * override instead of storing it, so the facility only carries real exceptions and later
 * changes to its type are not masked by a stale "yes". Ruling an element out needs a
 * justification; bringing one in does not, since assessing more is never a risk.
 */
export function applicabilityChange(
  byFramework: boolean,
  decision: ApplicabilityDecision,
): ApplicabilityChange {
  if (decision.applicable === byFramework) return { kind: "clear" };
  const justification = decision.justification?.trim() || null;
  if (!decision.applicable) {
    const problem = justificationProblem(justification);
    if (problem) return { kind: "invalid", problem };
  } else if (justification && justification.length > justificationLimits.max) {
    return { kind: "invalid", problem: "tooLong" };
  }
  return { kind: "set", applicable: decision.applicable, justification };
}

export type ApplicabilityContent = {
  chapters: { id: string; code: string; titleAr: string | null; titleEn: string | null }[];
  standards: { id: string; chapterId: string }[];
  elements: {
    id: string;
    standardId: string;
    code: string;
    titleAr: string | null;
    titleEn: string | null;
    isEsr: boolean;
    facilityTypes: readonly string[];
  }[];
};

export type ApplicabilityOverrideRow = ApplicabilityOverride & {
  elementId: string;
  decidedAt: Date;
};

export type ApplicabilityElement = ApplicabilityContent["elements"][number] &
  Applicability & { justification: string | null; decidedAt: Date | null };

export type ApplicabilityCounts = {
  total: number;
  applicable: number;
  notApplicable: number;
  // ESR elements ruled out: allowed, but the first thing a surveyor will question.
  esrNotApplicable: number;
};

export type ApplicabilityFilter = { chapter?: string; onlyNotApplicable?: boolean };

/**
 * One edition as it applies to one facility, grouped by chapter. Counts cover the whole
 * edition; the filter only narrows which elements are listed.
 */
export function buildApplicabilityView(
  content: ApplicabilityContent,
  facilityType: string,
  overrides: readonly ApplicabilityOverrideRow[],
  filter: ApplicabilityFilter = {},
) {
  const overrideByElement = new Map(overrides.map((o) => [o.elementId, o]));
  const chapterOfStandard = new Map(content.standards.map((s) => [s.id, s.chapterId]));
  const counts: ApplicabilityCounts = {
    total: 0,
    applicable: 0,
    notApplicable: 0,
    esrNotApplicable: 0,
  };
  const byChapter = new Map<string, ApplicabilityElement[]>();

  for (const element of content.elements) {
    const override = overrideByElement.get(element.id) ?? null;
    const resolved = resolveApplicability(element, facilityType, override);
    counts.total += 1;
    if (resolved.applicable) counts.applicable += 1;
    else {
      counts.notApplicable += 1;
      if (element.isEsr) counts.esrNotApplicable += 1;
    }
    const chapterId = chapterOfStandard.get(element.standardId);
    if (!chapterId) continue;
    if (filter.onlyNotApplicable && resolved.applicable) continue;
    const list = byChapter.get(chapterId) ?? [];
    list.push({
      ...element,
      ...resolved,
      justification: override?.justification ?? null,
      decidedAt: override?.decidedAt ?? null,
    });
    byChapter.set(chapterId, list);
  }

  const groups = content.chapters
    .filter((c) => !filter.chapter || c.code === filter.chapter)
    .map((chapter) => ({ chapter, elements: byChapter.get(chapter.id) ?? [] }))
    .filter((g) => g.elements.length > 0);
  return { counts, groups, shown: groups.reduce((n, g) => n + g.elements.length, 0) };
}

export type ApplicabilityView = ReturnType<typeof buildApplicabilityView>;
