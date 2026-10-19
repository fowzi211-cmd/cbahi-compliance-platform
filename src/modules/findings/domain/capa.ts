// Rule 7 (ARCHITECTURE §4): the CAPA lifecycle, escalation and finding verification.
// Calendar days travel as "YYYY-MM-DD" strings (Riyadh days), which compare correctly as
// text and cannot be shifted by a time zone.

import type { FindingStatus } from "./severity";

export const capaStatuses = ["open", "in_progress", "done", "cancelled"] as const;
export type CapaStatus = (typeof capaStatuses)[number];

export const capaTransitions = ["start", "complete", "cancel", "reopen"] as const;
export type CapaTransition = (typeof capaTransitions)[number];

export const capaEvidenceKinds = ["document", "link"] as const;
export type CapaEvidenceKind = (typeof capaEvidenceKinds)[number];

export const capaLimits = { action: 1000, note: 2000, url: 2000, description: 300 } as const;

const transitions: Record<CapaTransition, { from: readonly CapaStatus[]; to: CapaStatus }> = {
  start: { from: ["open"], to: "in_progress" },
  complete: { from: ["open", "in_progress"], to: "done" },
  cancel: { from: ["open", "in_progress"], to: "cancelled" },
  // A closure that did not hold (the evidence was weak, or the gap came back) is reopened
  // rather than replaced, so the history of the action stays in one place.
  reopen: { from: ["done"], to: "in_progress" },
};

/** The status a transition leads to, or null when it is not allowed from `status`. */
export function nextStatus(status: CapaStatus, transition: CapaTransition): CapaStatus | null {
  const rule = transitions[transition];
  return rule.from.includes(status) ? rule.to : null;
}

export type CapaProblem =
  | "invalidTransition"
  | "evidenceRequired"
  | "closureNoteRequired"
  | "reasonRequired"
  | "findingVerified";

/**
 * Why a transition cannot happen, or null. Anti-decoration: an action is done only with
 * closure evidence and a note saying what was done. Cancelling or reopening must say why,
 * because both change what the facility claims to have fixed. A verified finding is settled
 * by a later survey-grade score, so its actions cannot be reopened.
 */
export function transitionProblem(input: {
  status: CapaStatus;
  transition: CapaTransition;
  evidenceCount: number;
  note: string | null;
  findingStatus: FindingStatus;
}): CapaProblem | null {
  if (!nextStatus(input.status, input.transition)) return "invalidTransition";
  const hasNote = (input.note ?? "").trim().length > 0;
  switch (input.transition) {
    case "start":
      return null;
    case "complete":
      if (input.evidenceCount === 0) return "evidenceRequired";
      return hasNote ? null : "closureNoteRequired";
    case "cancel":
      return hasNote ? null : "reasonRequired";
    case "reopen":
      if (input.findingStatus === "verified") return "findingVerified";
      return hasNote ? null : "reasonRequired";
  }
}

export type CapaEvidenceProblem = "documentRequired" | "invalidUrl";

/** Evidence is an approved document version or a web link; nothing else proves an action. */
export function capaEvidenceProblem(input: {
  kind: CapaEvidenceKind;
  documentVersionId: string | null;
  url: string | null;
}): CapaEvidenceProblem | null {
  if (input.kind === "document") return input.documentVersionId ? null : "documentRequired";
  return input.url && isWebLink(input.url) ? null : "invalidUrl";
}

function isWebLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** A due date is set from today onwards; a plan that starts overdue is not a plan. */
export function dueDateProblem(dueOn: string, today: string): "dueInPast" | null {
  return dueOn < today ? "dueInPast" : null;
}

const isActive = (status: CapaStatus) => status === "open" || status === "in_progress";

/** Whole days from `from` to `to` ("YYYY-MM-DD"). */
export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** An action still open after its due day is overdue. Done and cancelled never are. */
export function isOverdue(item: { status: CapaStatus; dueOn: string }, today: string): boolean {
  return isActive(item.status) && today > item.dueOn;
}

export type EscalationLevel = 0 | 1 | 2 | 3;
export type EscalationTarget = "itemOwner" | "qualityManager" | "facilityOwner";

/**
 * The escalation schedule: overdue at all → the owner (level 1), 7 days overdue → the
 * quality manager (level 2), 14 days → the facility owner (level 3). Each level adds people;
 * nobody earlier is dropped.
 */
export const escalationSchedule: readonly {
  level: Exclude<EscalationLevel, 0>;
  daysOverdue: number;
  notify: EscalationTarget;
}[] = [
  { level: 1, daysOverdue: 1, notify: "itemOwner" },
  { level: 2, daysOverdue: 7, notify: "qualityManager" },
  { level: 3, daysOverdue: 14, notify: "facilityOwner" },
];

export function escalationLevel(
  item: { status: CapaStatus; dueOn: string },
  today: string,
): EscalationLevel {
  if (!isOverdue(item, today)) return 0;
  const overdue = daysFrom(item.dueOn, today);
  let level: EscalationLevel = 0;
  for (const step of escalationSchedule) if (overdue >= step.daysOverdue) level = step.level;
  return level;
}

/** Who is told at a level: everyone up to and including that step. */
export function escalationTargets(level: EscalationLevel): EscalationTarget[] {
  return escalationSchedule.filter((step) => step.level <= level).map((step) => step.notify);
}

/**
 * The escalation notices an action calls for on `today` (ARCHITECTURE §8): each level tells
 * the person it adds, once. Keyed to the due date, so moving the date starts afresh, and a
 * job that missed days catches up by sending every level reached so far.
 */
export function escalationNotices(
  item: { id: string; status: CapaStatus; dueOn: string },
  today: string,
): { level: Exclude<EscalationLevel, 0>; notify: EscalationTarget; dedupeKey: string }[] {
  const level = escalationLevel(item, today);
  return escalationSchedule
    .filter((step) => step.level <= level)
    .map((step) => ({
      level: step.level,
      notify: step.notify,
      dedupeKey: `capa:${item.id}:${item.dueOn}:level${step.level}`,
    }));
}

/**
 * A finding's status follows its actions: open with no live plan, closed when every
 * non-cancelled action is done, in progress otherwise. Verified is final: only a later
 * full-compliance score sets it, and nothing about the actions undoes it.
 */
export function findingStatusFor(
  current: FindingStatus,
  items: readonly { status: CapaStatus }[],
): FindingStatus {
  if (current === "verified") return "verified";
  const live = items.filter((item) => item.status !== "cancelled");
  if (live.length === 0) return "open";
  return live.every((item) => item.status === "done") ? "closed" : "in_progress";
}

/**
 * Rule 7: a closed finding is verified only by a later score at full compliance on the same
 * element, recorded after the finding closed. A score from before the fix proves nothing.
 */
export function verifiesFinding(
  finding: { status: FindingStatus; closedAt: Date | null },
  score: { normalized: number; scoredAt: Date },
): boolean {
  if (finding.status !== "closed" || !finding.closedAt) return false;
  return score.normalized >= 1 && score.scoredAt > finding.closedAt;
}
