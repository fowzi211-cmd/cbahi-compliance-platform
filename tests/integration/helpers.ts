import { randomUUID } from "node:crypto";
import { createTenant } from "@/modules/tenancy/service";

export async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const created = await createTenant({
    name: `${label} ${suffix}`,
    owner: { email: `owner-${suffix}@example.test`, name: `Owner ${label}` },
    facility: { nameAr: `منشأة ${label}`, nameEn: `Facility ${label}`, type: "polyclinic" },
  });
  return {
    ...created,
    ctx: { tenantId: created.tenant.id, userId: created.owner.id },
  };
}
