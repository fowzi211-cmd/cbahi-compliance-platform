import { createHash, randomBytes } from "node:crypto";
import { withoutTenant, withSystem, withTenant, type TenantContext, type Tx } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit, recordPlatformAudit } from "@/modules/audit/service";
import {
  createOrganizationInput,
  invitationExpiry,
  invitationStatus,
  inviteInput,
  sameEmail,
  type CreateOrganizationInput,
  type InvitationStatus,
  type InviteInput,
} from "./domain/invitations";
import {
  assignableRoles,
  can,
  canAssignRole,
  rolesInFacility,
  type Action,
  type Actor,
  type Resource,
} from "./domain/policy";
import {
  createTenantInput,
  departmentInput,
  facilityInput,
  membershipInput,
  type CreateTenantInput,
  type DepartmentInput,
  type FacilityInput,
  type MembershipInput,
  type MembershipRole,
} from "./domain/schemas";
import {
  isOnboardingStep,
  nextOnboardingStep,
  onboardingSteps,
  withStepDone,
  type OnboardingStep,
} from "./domain/onboarding";
import { sendInvitationEmail } from "./invitation-email";
import * as repo from "./repo";

export type { Action, Actor, Resource } from "./domain/policy";
export type { InvitationStatus } from "./domain/invitations";
export type { MembershipRole } from "./domain/schemas";
export { membershipRoles } from "./domain/schemas";
export { facilityTypes, type FacilityType } from "./domain/facility-types";
export { isOnboardingStep, onboardingSteps, stepAfter } from "./domain/onboarding";
export type { OnboardingStep } from "./domain/onboarding";

/**
 * Who is acting, in which tenant, and what they hold there. Built from the session by
 * `loadAccessContext`; services check it with `can()` before touching data.
 */
export type AccessContext = TenantContext & { userId: string; actor: Actor };

export function allowed(ctx: AccessContext, action: Action, resource: Resource): boolean {
  return can(ctx.actor, action, resource);
}

function authorize(ctx: AccessContext, action: Action, resource: Resource) {
  if (!can(ctx.actor, action, resource)) throw new ForbiddenError(action);
}

function isMemberOf(ctx: AccessContext, facilityId: string) {
  return rolesInFacility(ctx.actor, facilityId).length > 0;
}

/** Whether the caller holds any role in the facility (the bar for reading its setup). */
export function isFacilityMember(ctx: AccessContext, facilityId: string) {
  return isMemberOf(ctx, facilityId);
}

// --- Sessions and access ----------------------------------------------------------------------

/** Every facility role the user holds, across tenants. Keyed by the verified session's user. */
export function listUserMemberships(userId: string) {
  return withoutTenant((tx) => repo.listUserMemberships(tx, userId));
}

/** The access context for one tenant, or null when the user holds nothing there. */
export async function loadAccessContext(
  userId: string,
  tenantId: string,
): Promise<AccessContext | null> {
  const memberships = (await listUserMemberships(userId)).filter((m) => m.tenantId === tenantId);
  if (memberships.length === 0) return null;
  return {
    tenantId,
    userId,
    actor: {
      userId,
      memberships: memberships.map(({ facilityId, departmentId, role }) => ({
        facilityId,
        departmentId,
        role,
      })),
      // Consultant assignments arrive with M14.
      consultantFacilityIds: [],
    },
  };
}

/**
 * Creates a tenant with its subscription, first facility and owner membership. This spans
 * the platform and the new tenant, so it runs on the system connection and is audited.
 */
export async function createTenant(input: CreateTenantInput, actorUserId: string | null = null) {
  const data = createTenantInput.parse(input);
  return withSystem(async (tx) => {
    const tenant = await repo.insertTenant(tx, {
      name: data.name,
      tier: data.tier,
      startsOn: new Date(),
    });
    const owner = await repo.upsertUser(tx, data.owner);
    const facility = await repo.insertFacility(tx, tenant.id, data.facility);
    const membership = await repo.insertMembership(tx, tenant.id, {
      userId: owner.id,
      facilityId: facility.id,
      role: "facility_owner",
    });

    await recordPlatformAudit(tx, actorUserId, {
      action: "create",
      entity: "tenant",
      entityId: tenant.id,
      after: { name: tenant.name, tier: data.tier },
    });
    const ctx = { tenantId: tenant.id, userId: actorUserId };
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "facility",
      entityId: facility.id,
      after: facility,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "membership",
      entityId: membership.id,
      after: membership,
    });

    return { tenant, owner, facility };
  });
}

/**
 * Self-service start: a signed-in person with no facility yet creates their organization and
 * becomes owner of its first facility. Someone who already belongs to a facility must be
 * invited to others, so one account cannot spin up organizations at will.
 */
export async function createOrganization(
  user: { id: string; email: string; name: string },
  input: CreateOrganizationInput,
) {
  const data = createOrganizationInput.parse(input);
  if ((await listUserMemberships(user.id)).length > 0) {
    throw new DomainError("alreadyMember");
  }
  return createTenant(
    {
      name: data.organizationName,
      owner: { email: user.email, name: user.name },
      facility: {
        nameAr: data.facilityNameAr,
        nameEn: data.facilityNameEn,
        type: data.facilityType,
      },
    },
    user.id,
  );
}

/** Adding a facility is an organization-level decision, so it needs an owner. */
export async function createFacility(ctx: AccessContext, input: FacilityInput) {
  if (!ctx.actor.memberships.some((m) => m.role === "facility_owner")) {
    throw new ForbiddenError("facility.create");
  }
  const data = facilityInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const facility = await repo.insertFacility(tx, ctx.tenantId, data);
    // The creator owns the new facility, otherwise nobody could manage it.
    const membership = await repo.insertMembership(tx, ctx.tenantId, {
      userId: ctx.userId,
      facilityId: facility.id,
      role: "facility_owner",
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "facility",
      entityId: facility.id,
      after: facility,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "membership",
      entityId: membership.id,
      after: membership,
    });
    return facility;
  });
}

/** Null when the facility does not exist for this tenant or the caller holds no role in it. */
export async function getFacility(ctx: AccessContext, facilityId: string) {
  if (!isMemberOf(ctx, facilityId)) return null;
  return withTenant(ctx, (tx) => repo.findFacility(tx, ctx.tenantId, facilityId));
}

/** The facilities of this tenant that the caller holds a role in. */
export async function listFacilities(ctx: AccessContext) {
  const facilities = await withTenant(ctx, (tx) => repo.listFacilities(tx, ctx.tenantId));
  return facilities.filter((f) => isMemberOf(ctx, f.id));
}

/** Returns false when the facility does not exist for this tenant (including another tenant's). */
export async function renameFacility(
  ctx: AccessContext,
  facilityId: string,
  names: Pick<FacilityInput, "nameAr" | "nameEn">,
) {
  authorize(ctx, "facility.updateSettings", { facilityId });
  const data = facilityInput.pick({ nameAr: true, nameEn: true }).parse(names);
  return withTenant(ctx, async (tx) => {
    const before = await repo.findFacility(tx, ctx.tenantId, facilityId);
    if (!before) return false;
    await repo.updateFacility(tx, ctx.tenantId, facilityId, data);
    await recordAudit(tx, ctx, {
      action: "update",
      entity: "facility",
      entityId: facilityId,
      before: { nameAr: before.nameAr, nameEn: before.nameEn },
      after: data,
    });
    return true;
  });
}

/**
 * The facility's profile from the first onboarding step. Changing the type changes which
 * elements apply from then on; decisions the facility already recorded stay as they are.
 * Returns false when the facility does not exist for this tenant.
 */
export async function updateFacilityProfile(
  ctx: AccessContext,
  facilityId: string,
  input: FacilityInput,
) {
  authorize(ctx, "facility.updateSettings", { facilityId });
  const data = facilityInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const before = await repo.findFacility(tx, ctx.tenantId, facilityId);
    if (!before) return false;
    const after = {
      nameAr: data.nameAr,
      nameEn: data.nameEn,
      type: data.type,
      licenseNo: data.licenseNo ?? null,
      city: data.city ?? null,
    };
    await repo.updateFacility(tx, ctx.tenantId, facilityId, after);
    await recordAudit(tx, ctx, {
      action: "update",
      entity: "facility",
      entityId: facilityId,
      before: {
        nameAr: before.nameAr,
        nameEn: before.nameEn,
        type: before.type,
        licenseNo: before.licenseNo,
        city: before.city,
      },
      after,
    });
    return true;
  });
}

// --- Onboarding --------------------------------------------------------------------------------

export type OnboardingProgress = {
  done: OnboardingStep[];
  next: OnboardingStep | null;
  onboardedAt: Date | null;
};

/** Where the facility is in the onboarding wizard. Null when the caller is not a member. */
export async function getOnboardingProgress(
  ctx: AccessContext,
  facilityId: string,
): Promise<OnboardingProgress | null> {
  const facility = await getFacility(ctx, facilityId);
  if (!facility) return null;
  const done = onboardingSteps.filter((s) => facility.onboardingSteps.includes(s));
  return { done, next: nextOnboardingStep(done), onboardedAt: facility.onboardedAt };
}

/**
 * Records that a wizard step was saved. When the last open step is saved the facility is
 * marked onboarded (once: revisiting a step later does not move the date).
 */
export async function completeOnboardingStep(
  ctx: AccessContext,
  facilityId: string,
  step: OnboardingStep,
  now = new Date(),
) {
  authorize(ctx, "facility.updateSettings", { facilityId });
  if (!isOnboardingStep(step)) throw new DomainError("invalid");
  return withTenant(ctx, async (tx) => {
    const facility = await repo.findFacility(tx, ctx.tenantId, facilityId);
    if (!facility) return null;
    const done = withStepDone(facility.onboardingSteps, step);
    const finished = !facility.onboardedAt && nextOnboardingStep(done) === null;
    if (done.length !== facility.onboardingSteps.length || finished) {
      await repo.updateFacility(tx, ctx.tenantId, facilityId, {
        onboardingSteps: done,
        ...(finished ? { onboardedAt: now } : {}),
      });
    }
    if (finished) {
      await recordAudit(tx, ctx, {
        action: "complete",
        entity: "onboarding",
        entityId: facilityId,
        after: { steps: done },
      });
    }
    return {
      done,
      next: nextOnboardingStep(done),
      onboardedAt: facility.onboardedAt ?? (finished ? now : null),
    };
  });
}

export async function createDepartment(ctx: AccessContext, input: DepartmentInput) {
  const data = departmentInput.parse(input);
  authorize(ctx, "facility.updateSettings", { facilityId: data.facilityId });
  return withTenant(ctx, async (tx) => {
    if (data.typeCode && !(await repo.departmentTypeExists(tx, data.typeCode))) {
      throw new DomainError("unknownDepartmentType");
    }
    const department = await repo.insertDepartment(tx, ctx.tenantId, data);
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "department",
      entityId: department.id,
      after: department,
    });
    return department;
  });
}

export async function listDepartments(ctx: AccessContext, facilityId: string) {
  if (!isMemberOf(ctx, facilityId)) return [];
  return withTenant(ctx, (tx) => repo.listDepartments(tx, ctx.tenantId, facilityId));
}

/** Returns false when there is no such department in this tenant. */
export async function archiveDepartment(
  ctx: AccessContext,
  departmentId: string,
  now = new Date(),
) {
  return withTenant(ctx, async (tx) => {
    const department = await repo.findDepartment(tx, ctx.tenantId, departmentId);
    if (!department) return false;
    authorize(ctx, "facility.updateSettings", { facilityId: department.facilityId });
    const { count } = await repo.archiveDepartment(tx, ctx.tenantId, departmentId, now);
    if (count === 0) return false;
    await recordAudit(tx, ctx, {
      action: "archive",
      entity: "department",
      entityId: departmentId,
      before: { nameAr: department.nameAr, nameEn: department.nameEn },
    });
    return true;
  });
}

/** Grants a role directly (platform tooling and seeds); people normally join by invitation. */
export async function addMembership(ctx: AccessContext, input: MembershipInput) {
  const data = membershipInput.parse(input);
  authorize(ctx, "membership.manage", { facilityId: data.facilityId });
  if (!canAssignRole(ctx.actor, data.facilityId, data.role)) {
    throw new ForbiddenError(`membership.assign.${data.role}`);
  }
  return withTenant(ctx, async (tx) => {
    const membership = await repo.insertMembership(tx, ctx.tenantId, data);
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "membership",
      entityId: membership.id,
      after: membership,
    });
    return membership;
  });
}

export async function listMemberships(ctx: AccessContext, facilityId: string) {
  if (!isMemberOf(ctx, facilityId)) return [];
  return withTenant(ctx, (tx) => repo.listMemberships(tx, ctx.tenantId, facilityId));
}

/** Members with their names and emails, for the people screen. */
export async function listFacilityMembers(ctx: AccessContext, facilityId: string) {
  authorize(ctx, "membership.manage", { facilityId });
  return withTenant(ctx, (tx) => repo.listFacilityMembers(tx, ctx.tenantId, facilityId));
}

/**
 * The people of a facility by name, for any member: who can own a corrective action, and
 * whose name to show on one. Emails stay on the people screen.
 */
export async function listFacilityPeople(ctx: AccessContext, facilityId: string) {
  if (!isMemberOf(ctx, facilityId)) return [];
  const rows = await withTenant(ctx, (tx) =>
    repo.listFacilityMembers(tx, ctx.tenantId, facilityId),
  );
  const people = new Map<string, { userId: string; name: string; roles: MembershipRole[] }>();
  for (const row of rows) {
    const person = people.get(row.user.id) ?? {
      userId: row.user.id,
      name: row.user.name,
      roles: [],
    };
    person.roles.push(row.role);
    people.set(row.user.id, person);
  }
  return [...people.values()];
}
export type FacilityPerson = Awaited<ReturnType<typeof listFacilityPeople>>[number];

// --- For background jobs --------------------------------------------------------------------
// Jobs act for the tenant, not for a person, so these take the job's own tenant transaction.

/** Every tenant id, for jobs that visit each tenant in turn. Read-only. */
export async function listTenantIds(): Promise<string[]> {
  const rows = await withSystem((tx) => repo.listTenantIds(tx));
  return rows.map((row) => row.id);
}

/** The people holding any of `roles` in a facility (facility-wide or in a department). */
export async function listRoleHolders(
  tx: Tx,
  ctx: TenantContext,
  facilityId: string,
  roles: MembershipRole[],
): Promise<string[]> {
  const rows = await repo.listRoleHolders(tx, ctx.tenantId, facilityId, roles);
  return [...new Set(rows.map((row) => row.userId))];
}

/** The tenant's facilities (id and type), for jobs that work facility by facility. */
export async function listFacilitiesIn(tx: Tx, ctx: TenantContext) {
  const rows = await repo.listFacilities(tx, ctx.tenantId);
  return rows.map((f) => ({ id: f.id, type: f.type }));
}

/** One facility's id and type inside the caller's transaction, or null. */
export async function findFacilityIn(tx: Tx, ctx: TenantContext, facilityId: string) {
  const row = await repo.findFacility(tx, ctx.tenantId, facilityId);
  return row ? { id: row.id, type: row.type } : null;
}

/** A facility's active departments inside the caller's transaction. */
export async function listDepartmentsIn(tx: Tx, ctx: TenantContext, facilityId: string) {
  const rows = await repo.listDepartments(tx, ctx.tenantId, facilityId);
  return rows.map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn, typeCode: d.typeCode }));
}

/** Whom to email: name, address and sign-up language of members of this tenant. */
export function listRecipients(tx: Tx, ctx: TenantContext, userIds: string[]) {
  return repo.listRecipients(tx, ctx.tenantId, userIds);
}

export function getSubscription(ctx: AccessContext) {
  return withTenant(ctx, (tx) => repo.findSubscription(tx, ctx.tenantId));
}

// --- Invitations ------------------------------------------------------------------------------

export { assignableRoles };

const hashToken = (token: string) =>
  new Uint8Array(createHash("sha256").update(token, "utf8").digest());

/**
 * Invites someone by email into one facility role. The link carries a random token; only its
 * hash is stored. Re-inviting the same person to the same role revokes the earlier link.
 */
export async function inviteMember(ctx: AccessContext, input: InviteInput, now = new Date()) {
  const data = inviteInput.parse(input);
  authorize(ctx, "membership.manage", { facilityId: data.facilityId });
  if (!canAssignRole(ctx.actor, data.facilityId, data.role)) {
    throw new ForbiddenError(`membership.assign.${data.role}`);
  }

  const token = randomBytes(32).toString("base64url");
  const { invitation, facility, inviter } = await withTenant(ctx, async (tx) => {
    const facility = await repo.findFacility(tx, ctx.tenantId, data.facilityId);
    if (!facility) throw new ForbiddenError("membership.manage");
    if (data.departmentId) {
      const departments = await repo.listDepartments(tx, ctx.tenantId, data.facilityId);
      if (!departments.some((d) => d.id === data.departmentId)) {
        throw new DomainError("unknownDepartment");
      }
    }
    await repo.revokeOpenInvitations(tx, ctx.tenantId, data, now);
    const invitation = await repo.insertInvitation(tx, ctx.tenantId, {
      facilityId: data.facilityId,
      departmentId: data.departmentId,
      email: data.email,
      role: data.role,
      locale: data.locale,
      tokenHash: hashToken(token),
      invitedBy: ctx.userId,
      expiresAt: invitationExpiry(now),
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "invitation",
      entityId: invitation.id,
      after: { email: data.email, role: data.role, facilityId: data.facilityId },
    });
    const inviter = await repo.findUser(tx, ctx.userId);
    return { invitation, facility, inviter };
  });

  await sendInvitationEmail({
    to: data.email,
    locale: data.locale,
    token,
    role: data.role,
    facilityName: data.locale === "ar" ? facility.nameAr : facility.nameEn,
    inviterName: inviter?.name ?? "",
  });
  return { invitation, token };
}

export async function listOpenInvitations(
  ctx: AccessContext,
  facilityId: string,
  now = new Date(),
) {
  authorize(ctx, "membership.manage", { facilityId });
  return withTenant(ctx, (tx) => repo.listOpenInvitations(tx, ctx.tenantId, facilityId, now));
}

/** Returns false when there is no open invitation with that id in this tenant. */
export function revokeInvitation(ctx: AccessContext, invitationId: string, now = new Date()) {
  return withTenant(ctx, async (tx) => {
    const invitation = await repo.findInvitation(tx, ctx.tenantId, invitationId);
    if (!invitation) return false;
    authorize(ctx, "membership.manage", { facilityId: invitation.facilityId });
    const { count } = await repo.revokeInvitation(tx, ctx.tenantId, invitationId, now);
    if (count === 0) return false;
    await recordAudit(tx, ctx, {
      action: "revoke",
      entity: "invitation",
      entityId: invitationId,
      before: { email: invitation.email, role: invitation.role },
    });
    return true;
  });
}

export type InvitationSummary = {
  email: string;
  role: MembershipRole;
  facilityNameAr: string;
  facilityNameEn: string;
  expiresAt: Date;
  status: InvitationStatus;
};

/** What the invitation page shows before anyone signs in. Null for an unknown token. */
export async function findInvitationByToken(
  token: string,
  now = new Date(),
): Promise<InvitationSummary | null> {
  const row = await withoutTenant((tx) => repo.findInvitationByTokenHash(tx, hashToken(token)));
  if (!row) return null;
  return {
    email: row.email,
    role: row.role,
    facilityNameAr: row.facilityNameAr,
    facilityNameEn: row.facilityNameEn,
    expiresAt: row.expiresAt,
    status: invitationStatus(row, now),
  };
}

export type AcceptInvitationError = "notFound" | "expired" | "revoked" | "accepted" | "wrongEmail";

/**
 * Turns an invitation into a membership for the signed-in user. The token proves access to
 * the invited mailbox, and the signed-in email must match it, so a forwarded link cannot be
 * used by someone else.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email: string },
  now = new Date(),
): Promise<{ tenantId: string; facilityId: string }> {
  const row = await withoutTenant((tx) => repo.findInvitationByTokenHash(tx, hashToken(token)));
  if (!row) throw new DomainError<AcceptInvitationError>("notFound");
  const status = invitationStatus(row, now);
  if (status !== "pending") throw new DomainError<AcceptInvitationError>(status);
  if (!sameEmail(row.email, user.email)) throw new DomainError<AcceptInvitationError>("wrongEmail");

  const ctx = { tenantId: row.tenantId, userId: user.id };
  await withTenant(ctx, async (tx) => {
    const invitation = await repo.findInvitation(tx, row.tenantId, row.id);
    if (!invitation) throw new DomainError<AcceptInvitationError>("notFound");
    if ((await repo.markInvitationAccepted(tx, row.tenantId, row.id, user.id, now)) === 0) {
      throw new DomainError<AcceptInvitationError>("accepted");
    }
    const existing = await repo.findMembership(tx, row.tenantId, {
      userId: user.id,
      facilityId: invitation.facilityId,
      role: invitation.role,
    });
    const membership =
      existing ??
      (await repo.insertMembership(tx, row.tenantId, {
        userId: user.id,
        facilityId: invitation.facilityId,
        departmentId: invitation.departmentId ?? undefined,
        role: invitation.role,
      }));
    await recordAudit(tx, ctx, {
      action: "accept",
      entity: "invitation",
      entityId: invitation.id,
      after: { membershipId: membership.id, role: invitation.role },
    });
    if (!existing) {
      await recordAudit(tx, ctx, {
        action: "create",
        entity: "membership",
        entityId: membership.id,
        after: membership,
      });
    }
  });
  return { tenantId: row.tenantId, facilityId: row.facilityId };
}
