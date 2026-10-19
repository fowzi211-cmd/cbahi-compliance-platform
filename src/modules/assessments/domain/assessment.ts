// What one self-assessment covers, what evidence must contain, and when it can be submitted
// (ARCHITECTURE §4, "As built in M7").

export const assessmentKinds = ["self", "tracer", "mock_survey"] as const;
export type AssessmentKind = (typeof assessmentKinds)[number];

export const assessmentStatuses = ["in_progress", "submitted"] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

export const evidenceKinds = [
  "document",
  "observation",
  "interview",
  "record_review",
  "kpi",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export const evidenceLimits = { note: 2000, url: 2000, comment: 4000 } as const;

export type ScopeElement = { departmentTypes: readonly string[]; applicable: boolean };

/**
 * Whether an element belongs in an assessment. A whole-facility assessment covers every
 * element; a department assessment covers the elements the framework ties to that kind of
 * department. Facility-wide elements (no department types) are left to the facility-wide
 * assessment, so a department head is never asked to answer for governance they do not run.
 * Elements the facility ruled out are never scored (that decision is made once, in M5).
 */
export function inScope(element: ScopeElement, departmentType: string | null | undefined) {
  if (!element.applicable) return false;
  if (departmentType === undefined) return true;
  return departmentType !== null && element.departmentTypes.includes(departmentType);
}

export type EvidenceInput = {
  kind: EvidenceKind;
  note: string | null;
  url: string | null;
  // An approved version from the document library (M8).
  documentVersionId?: string | null;
};
export type EvidenceProblem = "documentRequired" | "invalidUrl" | "noteRequired";

/**
 * A document is cited from the library (an approved version) or, for documents kept
 * elsewhere, by a web link. Every other kind is a note of what was seen, heard or counted,
 * so it needs the note.
 */
export function evidenceProblem(input: EvidenceInput): EvidenceProblem | null {
  if (input.kind === "document") {
    if (input.documentVersionId) return null;
    if (!input.url) return "documentRequired";
    if (!isWebLink(input.url)) return "invalidUrl";
    return null;
  }
  return (input.note ?? "").trim() ? null : "noteRequired";
}

function isWebLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The elements still to score before submitting. A surveyor scores every applicable
 * element, so an assessment with gaps would overstate readiness and cannot be submitted.
 */
export function unscoredElements(
  scope: readonly { id: string }[],
  scoredElementIds: ReadonlySet<string>,
): string[] {
  return scope.filter((e) => !scoredElementIds.has(e.id)).map((e) => e.id);
}

/** How far through the assessment is. */
export function progress(scope: readonly { id: string }[], scoredElementIds: ReadonlySet<string>) {
  const scored = scope.filter((e) => scoredElementIds.has(e.id)).length;
  return { total: scope.length, scored };
}
