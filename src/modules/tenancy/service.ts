import { withSystem, withTenant, type TenantContext } from "@/lib/db";
import { recordAudit, recordPlatformAudit } from "@/modules/audit/service";
import {
  createTenantInput,
  departmentInput,
  facilityInput,
  membershipInput,
  type CreateTenantInput,
  type DepartmentInput,
  type FacilityInput,
  type MembershipInput,
} from "./domain/schemas";
import * as repo from "./repo";

// Permission checks (`can(ctx, action, resource)`) are added in M3 when authentication lands.
// Until then these services are only reachable from tests and seeds.

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

export function createFacility(ctx: TenantContext, input: FacilityInput) {
  const data = facilityInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const facility = await repo.insertFacility(tx, ctx.tenantId, data);
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "facility",
      entityId: facility.id,
      after: facility,
    });
    return facility;
  });
}

export function getFacility(ctx: TenantContext, facilityId: string) {
  return withTenant(ctx, (tx) => repo.findFacility(tx, ctx.tenantId, facilityId));
}

export function listFacilities(ctx: TenantContext) {
  return withTenant(ctx, (tx) => repo.listFacilities(tx, ctx.tenantId));
}

/** Returns false when the facility does not exist for this tenant (including another tenant's). */
export function renameFacility(
  ctx: TenantContext,
  facilityId: string,
  names: Pick<FacilityInput, "nameAr" | "nameEn">,
) {
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

export function createDepartment(ctx: TenantContext, input: DepartmentInput) {
  const data = departmentInput.parse(input);
  return withTenant(ctx, async (tx) => {
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

export function listDepartments(ctx: TenantContext, facilityId: string) {
  return withTenant(ctx, (tx) => repo.listDepartments(tx, ctx.tenantId, facilityId));
}

export function addMembership(ctx: TenantContext, input: MembershipInput) {
  const data = membershipInput.parse(input);
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

export function listMemberships(ctx: TenantContext, facilityId: string) {
  return withTenant(ctx, (tx) => repo.listMemberships(tx, ctx.tenantId, facilityId));
}

export function getSubscription(ctx: TenantContext) {
  return withTenant(ctx, (tx) => repo.findSubscription(tx, ctx.tenantId));
}
