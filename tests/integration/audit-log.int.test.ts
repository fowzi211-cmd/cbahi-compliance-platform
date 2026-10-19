import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withSystem, withTenant } from "@/lib/db";
import { listAuditEvents, recordAudit, verifyAuditChain } from "@/modules/audit/service";
import { renameFacility } from "@/modules/tenancy/service";
import { makeTenant } from "./helpers";

let t: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  t = await makeTenant("Audit");
});

afterAll(disconnectDb);

describe("audit log", () => {
  it("records a change with before and after values and the acting user", async () => {
    await renameFacility(t.ctx, t.facility.id, { nameAr: "اسم جديد", nameEn: "New name" });
    const [latest] = await listAuditEvents(t.ctx, { entity: "facility", entityId: t.facility.id });
    expect(latest).toMatchObject({
      action: "update",
      actorUserId: t.owner.id,
      before: { nameAr: "منشأة Audit", nameEn: "Facility Audit" },
      after: { nameAr: "اسم جديد", nameEn: "New name" },
    });
  });

  it("chains every tenant's events in order and verifies them", async () => {
    const events = await listAuditEvents(t.ctx);
    const seqs = events.map((event) => event.chainSeq).sort((x, y) => x - y);
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
    expect(await verifyAuditChain(t.ctx)).toEqual({
      ok: true,
      checked: events.length,
      firstBrokenSeq: null,
    });
  });

  it("stamps events with the server clock, ignoring a caller-supplied time", async () => {
    const before = Date.now();
    await withTenant(
      t.ctx,
      (tx) =>
        tx.$executeRaw`INSERT INTO audit_event (tenant_id, action, entity, at)
        VALUES (${t.tenant.id}::uuid, 'create', 'backdate-attempt', '2001-01-01T00:00:00Z')`,
    );
    const [event] = await listAuditEvents(t.ctx, { entity: "backdate-attempt" });
    expect(event.at.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });

  it("rolls back the audit record together with a failed change", async () => {
    await expect(
      withTenant(t.ctx, async (tx) => {
        await recordAudit(tx, t.ctx, { action: "create", entity: "rolled-back" });
        throw new Error("change failed");
      }),
    ).rejects.toThrow("change failed");
    expect(await listAuditEvents(t.ctx, { entity: "rolled-back" })).toEqual([]);
  });

  it.each([
    ["UPDATE", "UPDATE audit_event SET action = 'tampered'"],
    ["DELETE", "DELETE FROM audit_event"],
  ])("rejects %s from the app role", async (_, sql) => {
    await expect(withTenant(t.ctx, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(
      /permission denied|append-only/,
    );
  });

  it("rejects UPDATE, DELETE and TRUNCATE even from the system role", async () => {
    for (const sql of [
      "UPDATE audit_event SET action = 'tampered'",
      "DELETE FROM audit_event",
      "TRUNCATE audit_event",
    ]) {
      await expect(withSystem((tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(
        /permission denied|append-only/,
      );
    }
  });

  it("detects tampering done by a database superuser who disables the triggers", async () => {
    const victim = await makeTenant("Tampered");
    const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.connect();
    try {
      await admin.query("BEGIN");
      await admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_immutable_rows");
      await admin.query(
        'UPDATE audit_event SET after = \'{"nameEn":"forged"}\' WHERE tenant_id = $1 AND chain_seq = 1',
        [victim.tenant.id],
      );
      await admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_immutable_rows");
      await admin.query("COMMIT");
    } finally {
      await admin.end();
    }
    expect(await verifyAuditChain(victim.ctx)).toMatchObject({ ok: false, firstBrokenSeq: 1 });
  });
});
