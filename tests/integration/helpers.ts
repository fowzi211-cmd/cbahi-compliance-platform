import { randomUUID } from "node:crypto";
import { withSystem } from "@/lib/db";
import { createTenant, loadAccessContext, type AccessContext } from "@/modules/tenancy/service";

export async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const created = await createTenant({
    name: `${label} ${suffix}`,
    owner: { email: `owner-${suffix}@example.test`, name: `Owner ${label}` },
    facility: { nameAr: `منشأة ${label}`, nameEn: `Facility ${label}`, type: "polyclinic" },
  });
  const ctx = (await loadAccessContext(created.owner.id, created.tenant.id))!;
  return { ...created, ctx };
}

/**
 * A context whose permission layer has been fooled into thinking the caller also owns
 * `foreignFacilityId`. Used to prove that the database still refuses cross-tenant access
 * when `can()` is wrong.
 */
export function forgedContext(ctx: AccessContext, foreignFacilityId: string): AccessContext {
  return {
    ...ctx,
    actor: {
      ...ctx.actor,
      memberships: [
        ...ctx.actor.memberships,
        { facilityId: foreignFacilityId, departmentId: null, role: "facility_owner" },
      ],
    },
  };
}

export const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.test`;

/** A bare user row, as sign-up would create (without a password, which these tests skip). */
export function createUser(email: string, name = "Test user") {
  return withSystem((tx) => tx.user.create({ data: { email, name } }));
}
