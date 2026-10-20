import type { Tx } from "@/lib/db";
import type { MembershipRole, Tier } from "./domain/schemas";

// Every query here runs inside withTenant(), so RLS already limits rows to one tenant.
// Filters on tenant_id are still written out: the database is the second guard, not the only one.

export function insertTenant(tx: Tx, data: { name: string; tier: Tier; startsOn: Date }) {
  return tx.tenant.create({
    data: {
      name: data.name,
      subscription: { create: { tier: data.tier, startsOn: data.startsOn } },
    },
  });
}

export async function upsertUser(tx: Tx, data: { email: string; name: string }) {
  return tx.user.upsert({ where: { email: data.email }, create: data, update: {} });
}

export function insertFacility(
  tx: Tx,
  tenantId: string,
  data: { nameAr: string; nameEn: string; type: string; licenseNo?: string; city?: string },
) {
  return tx.facility.create({ data: { ...data, tenantId } });
}

export function findFacility(tx: Tx, tenantId: string, id: string) {
  return tx.facility.findFirst({ where: { tenantId, id, archivedAt: null } });
}

export function listFacilities(tx: Tx, tenantId: string) {
  return tx.facility.findMany({
    where: { tenantId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

export function updateFacility(
  tx: Tx,
  tenantId: string,
  id: string,
  data: {
    nameAr?: string;
    nameEn?: string;
    type?: string;
    licenseNo?: string | null;
    city?: string | null;
    onboardingSteps?: string[];
    onboardedAt?: Date | null;
  },
) {
  // updateMany so a row hidden by RLS is "0 rows updated", not an exception that leaks existence.
  return tx.facility.updateMany({ where: { tenantId, id, archivedAt: null }, data });
}

export function insertDepartment(
  tx: Tx,
  tenantId: string,
  data: { facilityId: string; nameAr: string; nameEn: string; typeCode?: string },
) {
  return tx.department.create({ data: { ...data, tenantId } });
}

export function findDepartment(tx: Tx, tenantId: string, id: string) {
  return tx.department.findFirst({ where: { tenantId, id, archivedAt: null } });
}

/** Archives rather than deletes: memberships and, later, records keep pointing at it. */
export function archiveDepartment(tx: Tx, tenantId: string, id: string, now: Date) {
  return tx.department.updateMany({
    where: { tenantId, id, archivedAt: null },
    data: { archivedAt: now },
  });
}

// The department-type catalogue is global (no tenant); the app role may read it.
export function departmentTypeExists(tx: Tx, code: string) {
  return tx.departmentType.findUnique({ where: { code }, select: { code: true } }).then(Boolean);
}

export function listDepartments(tx: Tx, tenantId: string, facilityId: string) {
  return tx.department.findMany({
    where: { tenantId, facilityId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

export function insertMembership(
  tx: Tx,
  tenantId: string,
  data: { userId: string; facilityId: string; departmentId?: string; role: MembershipRole },
) {
  return tx.membership.create({ data: { ...data, tenantId } });
}

export function listMemberships(tx: Tx, tenantId: string, facilityId: string) {
  return tx.membership.findMany({ where: { tenantId, facilityId }, orderBy: { createdAt: "asc" } });
}

export function findSubscription(tx: Tx, tenantId: string) {
  return tx.subscription.findUnique({ where: { tenantId } });
}

// --- Cross-tenant lookups through SECURITY DEFINER functions (see the M3 migration). ---------

export type UserMembershipRow = {
  tenantId: string;
  facilityId: string;
  departmentId: string | null;
  role: MembershipRole;
  facilityNameAr: string;
  facilityNameEn: string;
};

export async function listUserMemberships(tx: Tx, userId: string): Promise<UserMembershipRow[]> {
  const rows = await tx.$queryRaw<
    {
      tenant_id: string;
      facility_id: string;
      department_id: string | null;
      role: MembershipRole;
      facility_name_ar: string;
      facility_name_en: string;
    }[]
  >`SELECT * FROM app_user_memberships(${userId}::uuid)`;
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    departmentId: row.department_id,
    role: row.role,
    facilityNameAr: row.facility_name_ar,
    facilityNameEn: row.facility_name_en,
  }));
}

export type ConsultantFacilityRow = {
  tenantId: string;
  facilityId: string;
  facilityNameAr: string;
  facilityNameEn: string;
};

/**
 * Before the tenant is known: the facilities a platform consultant may open (live assignment,
 * tenant Hybrid today, consultant flag held). A SECURITY DEFINER lookup, like memberships.
 */
export async function listConsultantFacilities(
  tx: Tx,
  userId: string,
): Promise<ConsultantFacilityRow[]> {
  const rows = await tx.$queryRaw<
    { tenant_id: string; facility_id: string; facility_name_ar: string; facility_name_en: string }[]
  >`SELECT * FROM app_consultant_facilities(${userId}::uuid)`;
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    facilityNameAr: row.facility_name_ar,
    facilityNameEn: row.facility_name_en,
  }));
}

export type InvitationLookupRow = {
  id: string;
  tenantId: string;
  facilityId: string;
  email: string;
  role: MembershipRole;
  locale: string;
  facilityNameAr: string;
  facilityNameEn: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

export async function findInvitationByTokenHash(
  tx: Tx,
  tokenHash: Uint8Array<ArrayBuffer>,
): Promise<InvitationLookupRow | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      tenant_id: string;
      facility_id: string;
      email: string;
      role: MembershipRole;
      locale: string;
      facility_name_ar: string;
      facility_name_en: string;
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }[]
  >`SELECT * FROM app_find_invitation(${tokenHash})`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    email: row.email,
    role: row.role,
    locale: row.locale,
    facilityNameAr: row.facility_name_ar,
    facilityNameEn: row.facility_name_en,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

// --- Members and invitations (tenant-scoped). ------------------------------------------------

export function listFacilityMembers(tx: Tx, tenantId: string, facilityId: string) {
  return tx.membership.findMany({
    where: { tenantId, facilityId },
    select: {
      id: true,
      role: true,
      departmentId: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export function findMembership(
  tx: Tx,
  tenantId: string,
  data: { userId: string; facilityId: string; role: MembershipRole },
) {
  return tx.membership.findFirst({ where: { tenantId, ...data } });
}

export function insertInvitation(
  tx: Tx,
  tenantId: string,
  data: {
    facilityId: string;
    departmentId?: string;
    email: string;
    role: MembershipRole;
    locale: string;
    tokenHash: Uint8Array<ArrayBuffer>;
    invitedBy: string | null;
    expiresAt: Date;
  },
) {
  return tx.invitation.create({
    data: { ...data, tenantId },
    omit: { tokenHash: true },
  });
}

/** Revokes open invitations for the same person and role, so only the newest link works. */
export function revokeOpenInvitations(
  tx: Tx,
  tenantId: string,
  data: { facilityId: string; email: string; role: MembershipRole },
  now: Date,
) {
  return tx.invitation.updateMany({
    where: { tenantId, ...data, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
}

export function listOpenInvitations(tx: Tx, tenantId: string, facilityId: string, now: Date) {
  return tx.invitation.findMany({
    where: { tenantId, facilityId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    omit: { tokenHash: true },
    orderBy: { createdAt: "desc" },
  });
}

export function findInvitation(tx: Tx, tenantId: string, id: string) {
  return tx.invitation.findFirst({ where: { tenantId, id }, omit: { tokenHash: true } });
}

export function revokeInvitation(tx: Tx, tenantId: string, id: string, now: Date) {
  return tx.invitation.updateMany({
    where: { tenantId, id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Marks an invitation accepted. Returns 0 when someone else already used or revoked it. */
export async function markInvitationAccepted(
  tx: Tx,
  tenantId: string,
  id: string,
  userId: string,
  now: Date,
) {
  const result = await tx.invitation.updateMany({
    where: { tenantId, id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { acceptedAt: now, acceptedBy: userId },
  });
  return result.count;
}

export function findUser(tx: Tx, id: string) {
  return tx.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
}

export function listTenantIds(tx: Tx) {
  return tx.tenant.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
}

export function listRoleHolders(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  roles: MembershipRole[],
) {
  return tx.membership.findMany({
    where: { tenantId, facilityId, role: { in: roles } },
    select: { userId: true },
  });
}

/** Only users with a membership in this tenant: RLS on app_user hides everyone else. */
export function listRecipients(tx: Tx, tenantId: string, userIds: string[]) {
  return tx.user.findMany({
    where: { id: { in: userIds }, memberships: { some: { tenantId } } },
    select: { id: true, name: true, email: true, locale: true },
  });
}

/** Names of the given users that the tenant may see (RLS: its members and its consultants). */
export function listUserNames(tx: Tx, userIds: readonly string[]) {
  return tx.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, name: true },
  });
}
