// Rule 8 (ARCHITECTURE §4): the document lifecycle. Calendar days travel as "YYYY-MM-DD"
// strings, which compare correctly as text and cannot be shifted by a time zone.

export const documentTypes = ["policy", "procedure", "form", "plan", "other"] as const;
export type DocumentType = (typeof documentTypes)[number];

export const versionStatuses = ["in_review", "approved", "rejected", "superseded"] as const;
export type VersionStatus = (typeof versionStatuses)[number];

export const approvalDecisions = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];

export type VersionDates = {
  effectiveOn: string | null;
  reviewOn: string | null;
  expiresOn: string | null;
};

export type DatesProblem = "reviewBeforeEffective" | "expiryBeforeEffective" | "expiryBeforeReview";

/** Dates must tell a consistent story: in force first, reviewed later, expired last. */
export function versionDatesProblem(dates: VersionDates): DatesProblem | null {
  const { effectiveOn, reviewOn, expiresOn } = dates;
  if (effectiveOn && reviewOn && reviewOn <= effectiveOn) return "reviewBeforeEffective";
  if (effectiveOn && expiresOn && expiresOn <= effectiveOn) return "expiryBeforeEffective";
  if (reviewOn && expiresOn && expiresOn < reviewOn) return "expiryBeforeReview";
  return null;
}

export type DecisionProblem = "notInReview" | "commentRequired";

/**
 * Only a version waiting for review can be decided. A rejection must say why, so the author
 * knows what to change.
 */
export function decisionProblem(
  status: VersionStatus,
  decision: ApprovalDecision,
  comment: string | null,
): DecisionProblem | null {
  if (status !== "in_review") return "notInReview";
  if (decision === "rejected" && !(comment ?? "").trim()) return "commentRequired";
  return null;
}

export type VersionState =
  "pending" | "rejected" | "superseded" | "current" | "reviewDue" | "expired";

/**
 * Where a version stands on a given day. An approved version is in force until the day after
 * its expiry date; from its review date it is still in force but due for review.
 */
export function versionState(
  version: { status: VersionStatus; reviewOn: string | null; expiresOn: string | null },
  today: string,
): VersionState {
  switch (version.status) {
    case "in_review":
      return "pending";
    case "rejected":
      return "rejected";
    case "superseded":
      return "superseded";
    case "approved":
      if (version.expiresOn && today > version.expiresOn) return "expired";
      if (version.reviewOn && today >= version.reviewOn) return "reviewDue";
      return "current";
  }
}

/**
 * Only an approved version in force counts as evidence (rule 8). A version due for review
 * still counts: review is a reminder, expiry is a cut-off.
 */
export function isCitable(
  version: { status: VersionStatus; reviewOn: string | null; expiresOn: string | null },
  documentRetired: boolean,
  today: string,
): boolean {
  if (documentRetired) return false;
  const state = versionState(version, today);
  return state === "current" || state === "reviewDue";
}
