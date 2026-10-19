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
  data: { nameAr?: string; nameEn?: string; licenseNo?: string | null; city?: string | null },
) {
  // updateMany so a row hidden by RLS is "0 rows updated", not an exception that leaks existence.
  return tx.facility.updateMany({ where: { tenantId, id, archivedAt: null }, data });
}

export function insertDepartment(
  tx: Tx,
  tenantId: string,
  data: { facilityId: string; nameAr: string; nameEn: string },
) {
  return tx.department.create({ data: { ...data, tenantId } });
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
