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

/** A unique, fictional framework code so tests sharing the global library never collide. */
export const uniqueFrameworkCode = () => `DEMO-T${randomUUID().slice(0, 8).toUpperCase()}`;

/** A small fictional edition in the JSON import format. Never real accreditation text. */
export function demoEditionJson(
  code: string,
  edition: string,
  options: { esr?: string[]; elements?: string[] } = {},
) {
  const elements = options.elements ?? ["1", "2", "3"];
  const esr = new Set(options.esr ?? ["1"]);
  return JSON.stringify({
    format: "mustamir.framework/v1",
    framework: {
      code,
      edition,
      name_ar: "إطار تجريبي",
      name_en: "Demo framework",
      program: "ambulatory",
    },
    chapters: [{ code: "DEMO-X", title_ar: "فصل تجريبي", title_en: "Demo chapter" }],
    standards: [
      {
        code: "DEMO-X.1",
        chapter_code: "DEMO-X",
        title_ar: "معيار تجريبي",
        title_en: "Demo standard",
      },
    ],
    elements: elements.map((n) => ({
      code: `DEMO-X.1.${n}`,
      standard_code: "DEMO-X.1",
      title_ar: `عنصر تجريبي ${n}`,
      title_en: `Demo element ${n}`,
      is_esr: esr.has(n),
      department_types: n === "2" ? "nursing" : "",
    })),
  });
}
