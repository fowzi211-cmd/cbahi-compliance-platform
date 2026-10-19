import type { MembershipRole } from "./schemas";

// The RBAC policy (docs/ARCHITECTURE.md §6). This file is the single place that decides who
// may do what; services call `can()` before touching data, and the UI only mirrors it.

export const actions = [
  "facility.updateSettings",
  "membership.manage",
  "subscription.view",
  "assessment.score",
  "tracer.run",
  "tracer.manage",
  "mockSurvey.run",
  "committee.manage",
  "document.upload",
  "document.approve",
  "capa.create",
  "capa.recommend",
  "capa.closeOwn",
  "dashboard.view",
  "audit.view",
] as const;
export type Action = (typeof actions)[number];

// Consultants are platform staff, not tenant members, so they are not a MembershipRole.
export type PolicyRole = MembershipRole | "consultant";

export type Actor = {
  userId: string;
  memberships: readonly {
    facilityId: string;
    departmentId: string | null;
    role: MembershipRole;
  }[];
  // Facilities with an active consultant assignment on a Hybrid tenant (resolved in M14).
  consultantFacilityIds: readonly string[];
};

export type Resource = {
  facilityId: string;
  // The department the record belongs to; absent for facility-wide records.
  departmentId?: string | null;
  // The person responsible for the record (for example a CAPA item's owner).
  ownerUserId?: string | null;
  // People a task is assigned to (for example a tracer run).
  assigneeUserIds?: readonly string[];
  surveyKind?: "internal" | "consultant";
};

type Scope =
  "facility" | "ownDepartment" | "assigned" | "ownItem" | "internalSurvey" | "consultantSurvey";

/**
 * The matrix from ARCHITECTURE §6, one row per role. A missing action means "denied".
 * The platform super-admin is deliberately absent: it has no default access to tenant data.
 */
export const policyMatrix: Record<PolicyRole, Partial<Record<Action, Scope>>> = {
  facility_owner: {
    "facility.updateSettings": "facility",
    "membership.manage": "facility",
    "subscription.view": "facility",
    "assessment.score": "facility",
    "tracer.run": "facility",
    "tracer.manage": "facility",
    "committee.manage": "facility",
    "document.upload": "facility",
    "document.approve": "facility",
    "capa.create": "facility",
    "capa.closeOwn": "ownItem",
    "dashboard.view": "facility",
    "audit.view": "facility",
  },
  quality_manager: {
    "membership.manage": "facility",
    "assessment.score": "facility",
    "tracer.run": "facility",
    "tracer.manage": "facility",
    // Internal mock surveys only: a consultant survey must stay independent of the facility.
    "mockSurvey.run": "internalSurvey",
    "committee.manage": "facility",
    "document.upload": "facility",
    "document.approve": "facility",
    "capa.create": "facility",
    "capa.closeOwn": "ownItem",
    "dashboard.view": "facility",
    "audit.view": "facility",
  },
  department_head: {
    "assessment.score": "ownDepartment",
    "tracer.run": "ownDepartment",
    "tracer.manage": "ownDepartment",
    "document.upload": "ownDepartment",
    "capa.create": "ownDepartment",
    "capa.closeOwn": "ownItem",
    "dashboard.view": "ownDepartment",
  },
  staff: {
    "tracer.run": "assigned",
    "document.upload": "facility",
    "capa.closeOwn": "ownItem",
    "dashboard.view": "ownDepartment",
  },
  consultant: {
    "mockSurvey.run": "consultantSurvey",
    // A consultant recommends corrective actions; the facility decides and assigns them.
    "capa.recommend": "facility",
    "dashboard.view": "facility",
  },
  viewer: {
    "dashboard.view": "facility",
  },
};

function inScope(
  scope: Scope,
  actor: Actor,
  grantDepartmentId: string | null,
  resource: Resource,
): boolean {
  switch (scope) {
    case "facility":
      return true;
    case "ownDepartment":
      return grantDepartmentId !== null && resource.departmentId === grantDepartmentId;
    case "assigned":
      return resource.assigneeUserIds?.includes(actor.userId) ?? false;
    case "ownItem":
      return resource.ownerUserId === actor.userId;
    case "internalSurvey":
      return resource.surveyKind === "internal";
    case "consultantSurvey":
      return resource.surveyKind === "consultant";
  }
}

/** The roles an actor holds in one facility, with the department each grant is narrowed to. */
export function rolesInFacility(
  actor: Actor,
  facilityId: string,
): { role: PolicyRole; departmentId: string | null }[] {
  const grants: { role: PolicyRole; departmentId: string | null }[] = actor.memberships
    .filter((m) => m.facilityId === facilityId)
    .map((m) => ({ role: m.role, departmentId: m.departmentId }));
  if (actor.consultantFacilityIds.includes(facilityId)) {
    grants.push({ role: "consultant", departmentId: null });
  }
  return grants;
}

/** True when any of the actor's roles in the resource's facility allows the action. */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  return rolesInFacility(actor, resource.facilityId).some((grant) => {
    const scope = policyMatrix[grant.role][action];
    return scope !== undefined && inScope(scope, actor, grant.departmentId, resource);
  });
}

/**
 * Which roles someone may hand out in a facility. Granting a role must never raise anyone
 * above the granter: a quality manager can bring in department heads, staff and viewers,
 * but appointing a quality manager or another owner is a leadership decision for the owner.
 */
export function assignableRoles(actor: Actor, facilityId: string): MembershipRole[] {
  const roles = new Set(rolesInFacility(actor, facilityId).map((grant) => grant.role));
  if (roles.has("facility_owner")) {
    return ["facility_owner", "quality_manager", "department_head", "staff", "viewer"];
  }
  if (roles.has("quality_manager")) return ["department_head", "staff", "viewer"];
  return [];
}

export function canAssignRole(actor: Actor, facilityId: string, role: MembershipRole): boolean {
  return assignableRoles(actor, facilityId).includes(role);
}
