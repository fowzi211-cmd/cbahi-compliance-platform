// The life of a framework edition (ARCHITECTURE §9): an import creates a `draft`, the
// platform admin records the licence and activates it, and activating retires the edition
// that was live before. Retired editions stay readable so past assessments keep their text.

export const frameworkStatuses = ["draft", "active", "retired"] as const;
export type FrameworkStatus = (typeof frameworkStatuses)[number];

export type EditionState = { status: FrameworkStatus; licenseNote: string | null };

export type EditionBlocker = "notDraft" | "notActive" | "licenseRequired";

const hasLicense = (note: string | null) => (note ?? "").trim().length > 0;

/**
 * Why an edition cannot be activated, or null if it can. The licence note is mandatory:
 * framework text belongs to its publisher, and we must be able to show on what terms we
 * display it.
 */
export function activationBlocker(edition: EditionState): EditionBlocker | null {
  if (edition.status !== "draft") return "notDraft";
  if (!hasLicense(edition.licenseNote)) return "licenseRequired";
  return null;
}

export function retirementBlocker(edition: EditionState): EditionBlocker | null {
  return edition.status === "active" ? null : "notActive";
}

/** Only drafts can be deleted: nothing outside the platform team has seen them. */
export function deletionBlocker(edition: EditionState): EditionBlocker | null {
  return edition.status === "draft" ? null : "notDraft";
}

/**
 * The licence note can be corrected on a draft or a live edition, but a live edition can
 * never lose it.
 */
export function licenseNoteBlocker(edition: EditionState, note: string): EditionBlocker | null {
  if (edition.status === "retired") return "notDraft";
  if (edition.status === "active" && !hasLicense(note)) return "licenseRequired";
  return null;
}
