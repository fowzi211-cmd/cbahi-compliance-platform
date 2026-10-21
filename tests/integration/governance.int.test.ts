import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withoutTenant, withSystem, withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { ForbiddenError, RateLimitedError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { listAuditEvents } from "@/modules/audit/service";
import {
  canExportData,
  canViewAuditLog,
  exportTables,
  exportTenantData,
  getAuditChainStatus,
  getAuditLog,
} from "@/modules/governance/service";
import {
  addMembership,
  createFacility,
  inviteMember,
  loadAccessContext,
  renameFacility,
  type AccessContext,
} from "@/modules/tenancy/service";
import { approvedDemoDocument, createUser, makeTenant, uniqueEmail } from "./helpers";

// M16: the audit log viewer, the tenant data export and the app's rate limits.
const DAY = 86_400_000;
const today = toRiyadhDay(new Date());
const dayOf = (days: number) => toRiyadhDay(new Date(Date.now() + days * DAY));

let t: Awaited<ReturnType<typeof makeTenant>>;
let qm: AccessContext;
let viewer: AccessContext;

async function member(
  tenant: Awaited<ReturnType<typeof makeTenant>>,
  facilityId: string,
  role: "quality_manager" | "viewer",
) {
  const user = await createUser(uniqueEmail(role), `Demo ${role}`);
  await addMembership(tenant.ctx, { userId: user.id, facilityId, role });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

beforeAll(async () => {
  t = await makeTenant("Governance");
  qm = await member(t, t.facility.id, "quality_manager");
  viewer = await member(t, t.facility.id, "viewer");
  await renameFacility(t.ctx, t.facility.id, { nameAr: "منشأة الحوكمة", nameEn: "Governance" });
  await approvedDemoDocument(t.ctx, t.facility.id);
  await inviteMember(t.ctx, {
    facilityId: t.facility.id,
    email: uniqueEmail("invitee"),
    role: "staff",
  });
  // A job's event, recorded without a signed-in actor.
  await withTenant(
    t.ctx,
    (tx) =>
      tx.$executeRaw`INSERT INTO audit_event (tenant_id, action, entity) VALUES (${t.tenant.id}::uuid, 'update', 'survey_cycle')`,
  );
});

afterAll(disconnectDb);

describe("rate limits", () => {
  it("allows the window's allowance, then refuses with the time left", async () => {
    const subject = crypto.randomUUID();
    for (let i = 0; i < 3; i++) await consumeRateLimit("dataExport", subject);
    const error = await consumeRateLimit("dataExport", subject).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    const { retryAfterSeconds } = error as RateLimitedError;
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(3600);
    // Counted per person and per rule.
    await expect(consumeRateLimit("dataExport", crypto.randomUUID())).resolves.toBeUndefined();
    await expect(consumeRateLimit("upload", subject)).resolves.toBeUndefined();
  });

  it("starts a fresh count when the window has passed", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const hit = () =>
      withoutTenant(
        (tx) =>
          tx.$queryRaw<{ allowed: boolean }[]>`SELECT * FROM app_rate_limit_hit(${key}, 60, 1)`,
      );
    expect((await hit())[0]!.allowed).toBe(true);
    expect((await hit())[0]!.allowed).toBe(false);
    await withSystem(
      (tx) =>
        tx.$executeRaw`UPDATE rate_limit_bucket SET window_start = window_start - interval '2 minutes' WHERE key = ${key}`,
    );
    expect((await hit())[0]!.allowed).toBe(true);
  });

  it("keeps the counters away from the app role, and rejects nonsense limits", async () => {
    await expect(
      withoutTenant((tx) => tx.$queryRaw`SELECT * FROM rate_limit_bucket`),
    ).rejects.toThrow();
    await expect(
      withoutTenant((tx) => tx.$queryRaw`SELECT * FROM app_rate_limit_hit('x', 0, 1)`),
    ).rejects.toThrow();
  });
});

describe("the audit log viewer", () => {
  it("is for the owner and a quality manager of every facility, not other roles", async () => {
    expect(await canViewAuditLog(t.ctx)).toBe(true);
    expect(await canViewAuditLog(qm)).toBe(true);
    expect(await canViewAuditLog(viewer)).toBe(false);
    await expect(getAuditLog(viewer, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getAuditChainStatus(viewer)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a quality manager of one facility in a group of several", async () => {
    const group = await makeTenant("Governance group");
    const second = await createFacility(group.ctx, {
      nameAr: "فرع ثان",
      nameEn: "Second branch",
      type: "polyclinic",
    });
    const oneClinic = await member(group, group.facility.id, "quality_manager");
    const owner = (await loadAccessContext(group.owner.id, group.tenant.id))!;
    expect(await canViewAuditLog(owner)).toBe(true);
    expect(await canViewAuditLog(oneClinic)).toBe(false);
    await expect(getAuditLog(oneClinic, {})).rejects.toBeInstanceOf(ForbiddenError);
    await addMembership(owner, {
      userId: oneClinic.userId,
      facilityId: second.id,
      role: "quality_manager",
    });
    const both = (await loadAccessContext(oneClinic.userId, group.tenant.id))!;
    expect(await canViewAuditLog(both)).toBe(true);
  });

  it("lists the newest first, names the actors and offers the filter choices", async () => {
    const log = await getAuditLog(qm, {});
    const seqs = log.entries.map((e) => e.chainSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => y - x));
    expect(log.entries[0]).toMatchObject({ entity: "survey_cycle", actor: { kind: "system" } });
    const rename = log.entries.find((e) => e.entity === "facility" && e.action === "update");
    expect(rename?.actor).toEqual({ kind: "person", name: "Owner Governance" });
    expect(log.facets.actions).toEqual(expect.arrayContaining(["create", "update", "approve"]));
    expect(log.facets.entities).toEqual(expect.arrayContaining(["facility", "document"]));
    expect(log.facets.actors).toContainEqual({ id: t.owner.id, name: "Owner Governance" });
    expect(log.olderBefore).toBeNull();
    expect(await getAuditChainStatus(qm)).toMatchObject({ ok: true, firstBrokenSeq: null });
  });

  it("filters by action, record type, person and Riyadh day", async () => {
    const byAction = await getAuditLog(qm, { action: "approve" });
    expect(byAction.entries.length).toBeGreaterThan(0);
    expect(byAction.entries.every((e) => e.action === "approve")).toBe(true);
    const byEntity = await getAuditLog(qm, { entity: "invitation" });
    expect(byEntity.entries.map((e) => e.entity)).toEqual(["invitation"]);
    const byActor = await getAuditLog(qm, { actor: t.owner.id });
    expect(byActor.entries.every((e) => e.actorUserId === t.owner.id)).toBe(true);
    expect((await getAuditLog(qm, { from: today, to: today })).entries.length).toBeGreaterThan(0);
    expect((await getAuditLog(qm, { from: dayOf(1) })).entries).toEqual([]);
    expect((await getAuditLog(qm, { to: dayOf(-1) })).entries).toEqual([]);
  });

  it("pages through older events and ignores a malformed query", async () => {
    const all = await listAuditEvents(t.ctx, { limit: 1000 });
    const top = all[0]!.chainSeq;
    const page = await getAuditLog(qm, { before: String(top) });
    expect(page.entries[0]!.chainSeq).toBe(top - 1);
    const junk = await getAuditLog(qm, { actor: "not-a-user", from: "yesterday" });
    expect(junk.query).toEqual({});
    expect(junk.entries.length).toBe(Math.min(all.length, 50));
  });
});

describe("the data export", () => {
  it("is for the owner of every facility only", async () => {
    expect(await canExportData(t.ctx)).toBe(true);
    expect(await canExportData(qm)).toBe(false);
    await expect(exportTenantData(qm)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("covers every tenant-owned table", async () => {
    const tables = await withSystem(
      (tx) =>
        tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    const missing = tables
      .map((row) => row.table_name)
      .filter((name) => !(exportTables as readonly string[]).includes(name));
    expect(missing).toEqual([]);
  });

  it("packs the tables, people and files, without secrets, and audits it", async () => {
    const now = new Date();
    const { fileName, bytes } = await exportTenantData(t.ctx, now);
    expect(fileName).toBe(`mustamir-export-${toRiyadhDay(now)}.zip`);
    const zip = await JSZip.loadAsync(bytes);
    const json = async (path: string) => JSON.parse(await zip.file(path)!.async("string"));

    const [tenant] = await json("data/tenant.json");
    expect(tenant.id).toBe(t.tenant.id);
    const facilities = await json("data/facility.json");
    expect(facilities.map((f: { id: string }) => f.id)).toEqual([t.facility.id]);
    const invitations = await json("data/invitation.json");
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).not.toHaveProperty("token_hash");
    const people = await json("people.json");
    expect(people.map((p: { id: string }) => p.id)).toEqual(
      expect.arrayContaining([t.owner.id, qm.userId, viewer.userId]),
    );
    expect(JSON.stringify(people)).not.toMatch(/password|secret/i);

    const files = Object.keys(zip.files).filter(
      (path) => path.startsWith("files/") && !zip.files[path]!.dir,
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^files\/[0-9a-f-]{36}\/v1-policy\.pdf$/);
    const pdf = await zip.file(files[0]!)!.async("uint8array");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(await zip.file("README.txt")!.async("string")).toContain("Mustamir data export");

    const [event] = await listAuditEvents(t.ctx, { entity: "tenant", action: "export" });
    expect(event).toMatchObject({
      actorUserId: t.owner.id,
      entityId: t.tenant.id,
      after: { kind: "data_export", files: 1, bytes: bytes.length },
    });
  });

  it("is limited to three an hour", async () => {
    const owner = (await makeTenant("Governance limit")).ctx;
    for (let i = 0; i < 3; i++) await exportTenantData(owner);
    await expect(exportTenantData(owner)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
