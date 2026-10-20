import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { listAuditEvents } from "@/modules/audit/service";
import { setFacilityFrameworks } from "@/modules/standards/service";
import { runStruggleSignals } from "@/modules/subscriptions/jobs";
import {
  actOnRequestAsPlatform,
  actOnServiceRequest,
  assignConsultant,
  createServiceRequest,
  endConsultantAssignment,
  getOpenOffer,
  getSubscriptionOverview,
  getTenantForPlatform,
  isFeatureEnabled,
  listConsultantAccounts,
  listRequestsForPlatform,
  listServiceRequests,
  listTenants,
  setConsultant,
  updateSubscription,
  type PlatformActor,
} from "@/modules/subscriptions/service";
import {
  addMembership,
  getFacility,
  listConsultantFacilities,
  loadAccessContext,
} from "@/modules/tenancy/service";
import {
  createUser,
  makeTenant,
  publishDemoEdition,
  submitDemoAssessment,
  uniqueEmail,
} from "./helpers";

// M14: tiers and feature gates, consultant assignments, service requests and the struggle
// signal, against a real database with RLS on.
const DAY = 86_400_000;
const start = new Date();
const at = (days: number) => new Date(start.getTime() + days * DAY);
const dayOf = (days: number) => toRiyadhDay(at(days));

let admin: PlatformActor;
let a: Awaited<ReturnType<typeof makeTenant>>;
let b: Awaited<ReturnType<typeof makeTenant>>;
let consultant: { id: string; email: string };

const hybrid = (over: { startsOn?: string; endsOn?: string | null } = {}) => ({
  tier: "hybrid" as const,
  startsOn: over.startsOn ?? dayOf(-30),
  endsOn: over.endsOn === undefined ? dayOf(335) : over.endsOn,
});

beforeAll(async () => {
  const adminUser = await createUser(uniqueEmail("platform-admin"));
  admin = { userId: adminUser.id, isPlatformAdmin: true };
  a = await makeTenant("Subscriptions A");
  b = await makeTenant("Subscriptions B");
  const email = uniqueEmail("consultant");
  consultant = { id: (await createUser(email)).id, email };
  await setConsultant(admin, email, true);
});

afterAll(async () => {
  await disconnectDb();
});

describe("tiers and feature gates", () => {
  it("starts every tenant on Platform, with the struggle signal and no consultants", async () => {
    expect(await isFeatureEnabled(a.ctx, "struggleSignal")).toBe(true);
    expect(await isFeatureEnabled(a.ctx, "consultantAssignment")).toBe(false);
    const overview = await getSubscriptionOverview(a.ctx, a.facility.id);
    expect(overview).toMatchObject({ tier: "platform", effectiveTier: "platform" });
  });

  it("lets only the platform admin change a tier, and audits it in the tenant's chain", async () => {
    await expect(
      updateSubscription({ userId: a.owner.id, isPlatformAdmin: false }, a.tenant.id, hybrid()),
    ).rejects.toThrow("platform.manage");
    await expect(
      updateSubscription(admin, a.tenant.id, hybrid({ endsOn: dayOf(-40) })),
    ).rejects.toThrow("endsBeforeStart");

    await updateSubscription(admin, a.tenant.id, {
      ...hybrid(),
      overrides: { struggleSignal: "on" },
    });
    expect(await isFeatureEnabled(a.ctx, "consultantAssignment")).toBe(true);
    expect(await isFeatureEnabled(a.ctx, "struggleSignal")).toBe(true);
    const events = await listAuditEvents(a.ctx, { entity: "subscription" });
    expect(events[0]).toMatchObject({ action: "update", actorUserId: admin.userId });

    await updateSubscription(admin, a.tenant.id, hybrid());
    expect(await isFeatureEnabled(a.ctx, "struggleSignal")).toBe(false);
  });

  it("finds tenants by name for the platform screen", async () => {
    const found = await listTenants(admin, a.tenant.name);
    expect(found.map((t) => t.id)).toEqual([a.tenant.id]);
    expect(found[0]!.subscription?.effectiveTier).toBe("hybrid");
    await expect(listTenants({ userId: a.owner.id, isPlatformAdmin: false })).rejects.toThrow();
  });
});

describe("consultant assignments", () => {
  it("refuses a tenant whose tier does not include consultants", async () => {
    await expect(
      assignConsultant(admin, b.tenant.id, b.facility.id, consultant.id),
    ).rejects.toThrow("featureOff");
  });

  it("refuses an account without the consultant flag", async () => {
    const someone = await createUser(uniqueEmail("not-consultant"));
    await expect(assignConsultant(admin, a.tenant.id, a.facility.id, someone.id)).rejects.toThrow(
      "notConsultant",
    );
  });

  it("gives a consultant the assigned facility and nothing else", async () => {
    const assignmentId = await assignConsultant(admin, a.tenant.id, a.facility.id, consultant.id);
    await expect(
      assignConsultant(admin, a.tenant.id, a.facility.id, consultant.id),
    ).rejects.toThrow("alreadyAssigned");

    expect((await listConsultantFacilities(consultant.id)).map((f) => f.facilityId)).toEqual([
      a.facility.id,
    ]);
    const ctx = (await loadAccessContext(consultant.id, a.tenant.id))!;
    expect(ctx.actor.consultantFacilityIds).toEqual([a.facility.id]);
    expect(ctx.actor.memberships).toEqual([]);
    expect(await getFacility(ctx, a.facility.id)).not.toBeNull();
    expect(await loadAccessContext(consultant.id, b.tenant.id)).toBeNull();

    // The owner sees who has access; the platform screen lists the assignment.
    const overview = await getSubscriptionOverview(a.ctx, a.facility.id);
    expect(overview?.consultants.map((c) => c.email)).toEqual([consultant.email]);
    const tenant = await getTenantForPlatform(admin, a.tenant.id);
    expect(tenant?.facilities[0]?.consultants.map((c) => c.assignmentId)).toEqual([assignmentId]);
    const events = await listAuditEvents(a.ctx, { entity: "consultant_assignment" });
    expect(events[0]).toMatchObject({ action: "create", entityId: assignmentId });
  });

  it("cuts access when the Hybrid term ends, and restores it when renewed", async () => {
    await updateSubscription(
      admin,
      a.tenant.id,
      hybrid({ startsOn: dayOf(-60), endsOn: dayOf(-1) }),
    );
    expect(await listConsultantFacilities(consultant.id)).toEqual([]);
    expect(await loadAccessContext(consultant.id, a.tenant.id)).toBeNull();
    await updateSubscription(admin, a.tenant.id, hybrid());
    expect(await listConsultantFacilities(consultant.id)).toHaveLength(1);
  });

  it("cuts access when the assignment ends", async () => {
    const tenant = (await getTenantForPlatform(admin, a.tenant.id))!;
    const assignmentId = tenant.facilities[0]!.consultants[0]!.assignmentId;
    await expect(endConsultantAssignment(admin, b.tenant.id, assignmentId)).rejects.toThrow(
      "notFound",
    );
    await endConsultantAssignment(admin, a.tenant.id, assignmentId);
    expect(await listConsultantFacilities(consultant.id)).toEqual([]);
    expect((await getSubscriptionOverview(a.ctx, a.facility.id))?.consultants).toEqual([]);
  });

  it("ends every assignment when the consultant flag is taken away", async () => {
    await assignConsultant(admin, a.tenant.id, a.facility.id, consultant.id);
    expect(await listConsultantFacilities(consultant.id)).toHaveLength(1);
    await setConsultant(admin, consultant.email, false);
    expect(await listConsultantFacilities(consultant.id)).toEqual([]);
    expect((await listConsultantAccounts(admin)).some((c) => c.id === consultant.id)).toBe(false);
    await setConsultant(admin, consultant.email, true);
    // Ended assignments stay ended: access is given again only on purpose.
    expect(await listConsultantFacilities(consultant.id)).toEqual([]);
    await expect(setConsultant(admin, uniqueEmail("nobody"), true)).rejects.toThrow("noAccount");
  });
});

describe("service requests", () => {
  it("lets the owner and quality manager ask, and no one else", async () => {
    const staff = await createUser(uniqueEmail("staff"));
    await addMembership(b.ctx, { userId: staff.id, facilityId: b.facility.id, role: "staff" });
    const staffCtx = (await loadAccessContext(staff.id, b.tenant.id))!;
    await expect(
      createServiceRequest(staffCtx, b.facility.id, { kind: "consultation", note: "" }),
    ).rejects.toThrow("service.request");
    expect(await listServiceRequests(staffCtx, b.facility.id)).toBeNull();

    const id = await createServiceRequest(b.ctx, b.facility.id, {
      kind: "mock_survey",
      note: "Before our survey in spring.",
    });
    const [row] = (await listServiceRequests(b.ctx, b.facility.id))!;
    expect(row).toMatchObject({ id, kind: "mock_survey", status: "open", origin: "user" });
  });

  it("is worked by the platform team, and the facility can withdraw it only until then", async () => {
    const id = await createServiceRequest(b.ctx, b.facility.id, { kind: "consultation", note: "" });
    expect((await listRequestsForPlatform(admin)).some((r) => r.id === id)).toBe(true);
    await actOnRequestAsPlatform(admin, id, "start", "Booked for next week.");
    await expect(actOnServiceRequest(b.ctx, id, "cancel")).rejects.toThrow("notAllowed");
    await expect(actOnRequestAsPlatform(admin, id, "start")).rejects.toThrow("notAllowed");
    await actOnRequestAsPlatform(admin, id, "complete");
    const row = (await listServiceRequests(b.ctx, b.facility.id))!.find((r) => r.id === id)!;
    expect(row).toMatchObject({ status: "done", platformNote: "Booked for next week." });
    expect(row.closedAt).not.toBeNull();
    expect((await listRequestsForPlatform(admin, "closed")).some((r) => r.id === id)).toBe(true);

    const other = await createServiceRequest(b.ctx, b.facility.id, {
      kind: "gap_assessment",
      note: "",
    });
    await actOnServiceRequest(b.ctx, other, "cancel");
    await expect(actOnServiceRequest(a.ctx, other, "cancel")).rejects.toThrow("notFound");
  });
});

describe("struggle signal", () => {
  let tenant: Awaited<ReturnType<typeof makeTenant>>;

  beforeAll(async () => {
    tenant = await makeTenant("Struggling");
    const { frameworkId } = await publishDemoEdition({ esr: ["1"] });
    await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [frameworkId]);
    // The ESR element is scored Not Met.
    await submitDemoAssessment(tenant.ctx, tenant.facility.id, frameworkId);
  });

  it("offers help once, waits for an answer, then keeps a 14-day cool-down", async () => {
    const [offerId] = await runStruggleSignals(tenant.tenant.id, at(0));
    expect(offerId).toBeDefined();
    const offer = await getOpenOffer(tenant.ctx, tenant.facility.id);
    expect(offer).toMatchObject({ id: offerId, status: "offered", kind: null });
    expect(offer?.signalReasons).toContain("esrNotMet");

    // Unanswered: no second offer, however long it waits.
    expect(await runStruggleSignals(tenant.tenant.id, at(20))).toEqual([]);
    await expect(actOnServiceRequest(tenant.ctx, offerId!, "accept")).rejects.toThrow(
      "kindRequired",
    );
    await actOnServiceRequest(tenant.ctx, offerId!, "dismiss", {}, at(1));
    expect(await getOpenOffer(tenant.ctx, tenant.facility.id)).toBeNull();
    // Counted from the offer, not the answer.
    expect(await runStruggleSignals(tenant.tenant.id, at(13))).toEqual([]);
    const [again] = await runStruggleSignals(tenant.tenant.id, at(14));
    expect(again).toBeDefined();

    await actOnServiceRequest(tenant.ctx, again!, "accept", { kind: "gap_assessment" }, at(15));
    const accepted = (await listServiceRequests(tenant.ctx, tenant.facility.id))!.find(
      (r) => r.id === again,
    );
    expect(accepted).toMatchObject({
      status: "open",
      kind: "gap_assessment",
      origin: "struggle_signal",
    });
    expect((await listRequestsForPlatform(admin)).some((r) => r.id === again)).toBe(true);
  });

  it("stays quiet for Hybrid tenants and for facilities with nothing to judge", async () => {
    await updateSubscription(admin, tenant.tenant.id, hybrid());
    expect(await runStruggleSignals(tenant.tenant.id, at(60))).toEqual([]);
    expect(await runStruggleSignals(b.tenant.id, at(60))).toEqual([]);
  });
});
