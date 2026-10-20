// The service-request lifecycle (ARCHITECTURE §4, "As built in M14"). A request is a ticket
// for the platform team: the facility asks (or answers an offer), the platform works it.

export const requestKinds = ["mock_survey", "consultation", "gap_assessment"] as const;
export type RequestKind = (typeof requestKinds)[number];

export const requestStatuses = [
  "offered",
  "open",
  "in_progress",
  "done",
  "dismissed",
  "cancelled",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const facilityRequestActions = ["accept", "dismiss", "cancel"] as const;
export type FacilityRequestAction = (typeof facilityRequestActions)[number];

export const platformRequestActions = ["start", "complete", "cancel"] as const;
export type PlatformRequestAction = (typeof platformRequestActions)[number];

const facilityMoves: Record<
  FacilityRequestAction,
  Partial<Record<RequestStatus, RequestStatus>>
> = {
  // Taking up an offer sends it to the platform team like any request.
  accept: { offered: "open" },
  dismiss: { offered: "dismissed" },
  // The facility may withdraw a request until the platform team has started on it.
  cancel: { open: "cancelled" },
};

const platformMoves: Record<
  PlatformRequestAction,
  Partial<Record<RequestStatus, RequestStatus>>
> = {
  start: { open: "in_progress" },
  complete: { in_progress: "done" },
  cancel: { open: "cancelled", in_progress: "cancelled" },
};

/** The status after a facility action, or null when the action does not apply. */
export function facilityTransition(status: RequestStatus, action: FacilityRequestAction) {
  return facilityMoves[action][status] ?? null;
}

/** The status after a platform action, or null when the action does not apply. */
export function platformTransition(status: RequestStatus, action: PlatformRequestAction) {
  return platformMoves[action][status] ?? null;
}

export const closedStatuses: readonly RequestStatus[] = ["done", "dismissed", "cancelled"];

export const requestLimits = { note: 2000 } as const;
