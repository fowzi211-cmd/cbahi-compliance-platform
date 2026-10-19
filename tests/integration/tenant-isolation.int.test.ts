import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withTenant } from "@/lib/db";
import { listAuditEvents } from "@/modules/audit/service";
import {
  addMembership,
  createDepartment,
  getFacility,
  getSubscription,
  listDepartments,
  listFacilities,
  listMemberships,
  renameFacility,
} from "@/modules/tenancy/service";
import { makeTenant } from "./helpers";

// Two tenants side by side. Every read and write made as tenant A must be blind to tenant B,
// both through the services and through raw SQL (the RLS layer on its own).
let a: Awaited<ReturnType<typeof makeTenant>>;
let b: Awaited<ReturnType<typeof makeTenant>>;
let bDepartmentId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([makeTenant("A"), makeTenant("B")]);
  await createDepartment(a.ctx, {
    facilityId: a.facility.id,
    nameAr: "استقبال",
    nameEn: "Reception",
  });
  bDepartmentId = (
    await createDepartment(b.ctx, { facilityId: b.facility.id, nameAr: "مختبر", nameEn: "Lab" })
  ).id;
});

afterAll(disconnectDb);

describe("service layer", () => {
  it("lists only the caller's facilities", async () => {
    const facilities = await listFacilities(a.ctx);
    expect(facilities.map((f) => f.id)).toEqual([a.facility.id]);
  });

  it("cannot read another tenant's facility by id", async () => {
    expect(await getFacility(a.ctx, b.facility.id)).toBeNull();
  });

  it("cannot update another tenant's facility", async () => {
    expect(await renameFacility(a.ctx, b.facility.id, { nameAr: "اختراق", nameEn: "Hijack" })).toBe(
      false,
    );
    expect((await getFacility(b.ctx, b.facility.id))?.nameEn).toBe("Facility B");
  });

  it("cannot list another tenant's departments or memberships", async () => {
    expect(await listDepartments(a.ctx, b.facility.id)).toEqual([]);
    expect(await listMemberships(a.ctx, b.facility.id)).toEqual([]);
  });

  it("cannot attach a department to another tenant's facility", async () => {
    await expect(
      createDepartment(a.ctx, { facilityId: b.facility.id, nameAr: "x", nameEn: "x" }),
    ).rejects.toThrow();
  });

  it("cannot grant a membership in another tenant's facility or department", async () => {
    await expect(
      addMembership(a.ctx, { userId: a.owner.id, facilityId: b.facility.id, role: "viewer" }),
    ).rejects.toThrow();
    await expect(
      addMembership(a.ctx, {
        userId: a.owner.id,
        facilityId: a.facility.id,
        departmentId: bDepartmentId,
        role: "department_head",
      }),
    ).rejects.toThrow();
  });

  it("sees only its own subscription and audit trail", async () => {
    expect((await getSubscription(a.ctx))?.tenantId).toBe(a.tenant.id);
    const events = await listAuditEvents(a.ctx);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.tenantId === a.tenant.id)).toBe(true);
  });
});

describe("database layer (RLS) on its own", () => {
  const tenantColumn: Record<string, string> = {
    tenant: "id",
    subscription: "tenant_id",
    facility: "tenant_id",
    department: "tenant_id",
    membership: "tenant_id",
    audit_event: "tenant_id",
  };

  it.each(Object.entries(tenantColumn))(
    "raw SQL on %s cannot see another tenant's rows",
    async (table, column) => {
      const [visible] = await withTenant(a.ctx, (tx) =>
        tx.$queryRawUnsafe<{ own: number; other: number }[]>(
          `SELECT count(*) FILTER (WHERE ${column} = $1::uuid)::int AS own,
                  count(*) FILTER (WHERE ${column} = $2::uuid)::int AS other
           FROM ${table}`,
          a.tenant.id,
          b.tenant.id,
        ),
      );
      expect(visible.own).toBeGreaterThan(0);
      expect(visible.other).toBe(0);
    },
  );

  it("shows other tenants' users only through a shared membership", async () => {
    const emails = await withTenant(
      a.ctx,
      (tx) => tx.$queryRaw<{ email: string }[]>`SELECT email FROM app_user`,
    );
    expect(emails.map((row) => row.email)).toEqual([a.owner.email]);
  });

  it("rejects inserting a row tagged with another tenant", async () => {
    await expect(
      withTenant(
        a.ctx,
        (tx) =>
          tx.$executeRaw`INSERT INTO facility (id, tenant_id, name_ar, name_en, type, updated_at)
          VALUES (${randomUUID()}::uuid, ${b.tenant.id}::uuid, 'x', 'x', 'polyclinic', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects moving a row to another tenant", async () => {
    await expect(
      withTenant(
        a.ctx,
        (tx) =>
          tx.$executeRaw`UPDATE facility SET tenant_id = ${b.tenant.id}::uuid WHERE id = ${a.facility.id}::uuid`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let the app change its own tier", async () => {
    await expect(
      withTenant(a.ctx, (tx) => tx.$executeRaw`UPDATE subscription SET tier = 'hybrid'`),
    ).rejects.toThrow(/permission denied/);
  });

  it("sees nothing when no tenant is set (fails closed)", async () => {
    const rows = await withTenant(a.ctx, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
      return tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM facility`;
    });
    expect(rows[0].n).toBe(0);
  });

  it("does not leak the tenant setting to the next transaction on a pooled connection", async () => {
    await withTenant(a.ctx, async () => undefined);
    const rows = await withTenant(
      b.ctx,
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM facility`,
    );
    expect(rows.map((row) => row.id)).toEqual([b.facility.id]);
  });
});
