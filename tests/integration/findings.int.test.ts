import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import {
  getAssessmentSheet,
  getReadiness,
  saveElementScore,
  startAssessment,
  submitAssessment,
} from "@/modules/assessments/service";
import { listAuditEvents } from "@/modules/audit/service";
import {
  addCapaEvidence,
  countOverdueCapa,
  createCapaItem,
  getFinding,
  listCapaOwners,
  listFindings,
  listMyCapaItems,
  removeCapaEvidence,
  rescheduleCapaItem,
  transitionCapaItem,
  type Finding,
} from "@/modules/findings/service";
import { setFacilityFrameworks } from "@/modules/standards/service";
import {
  addMembership,
  createDepartment,
  loadAccessContext,
  type AccessContext,
} from "@/modules/tenancy/service";
import {
  approvedDemoDocument,
  createUser,
  makeTenant,
  publishDemoEdition,
  submitDemoAssessment,
  uniqueEmail,
} from "./helpers";

// M9: findings and CAPA against a fictional edition. Element 1 is ESR, element 2 belongs to
// nursing. A whole-facility assessment raised a finding on every element.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let frameworkId: string;
let nursingId: string;
let qm: AccessContext;
let nursingHead: AccessContext;
let staff: AccessContext;
let viewer: AccessContext;
let findings: Finding[];
let documentVersionId: string;

const day = (offsetDays: number, from = new Date()) =>
  toRiyadhDay(new Date(from.getTime() + offsetDays * 86_400_000));

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof DomainError
        ? error.code
        : error instanceof ForbiddenError
          ? "forbidden"
          : String(error),
  );

async function member(
  role: "quality_manager" | "department_head" | "staff" | "viewer",
  departmentId?: string,
) {
  const user = await createUser(uniqueEmail(role), `Demo ${role}`);
  await addMembership(tenant.ctx, {
    userId: user.id,
    facilityId: tenant.facility.id,
    role,
    ...(departmentId ? { departmentId } : {}),
  });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

const findingOn = (n: string) => findings.find((f) => f.element.code.endsWith(`.${n}`))!;

beforeAll(async () => {
  tenant = await makeTenant("Findings");
  ({ frameworkId } = await publishDemoEdition({ elements: ["1", "2", "3"], esr: ["1"] }));
  await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [frameworkId]);
  nursingId = (
    await createDepartment(tenant.ctx, {
      facilityId: tenant.facility.id,
      nameAr: "التمريض",
      nameEn: "Nursing",
      typeCode: "nursing",
    })
  ).id;
  qm = await member("quality_manager");
  nursingHead = await member("department_head", nursingId);
  staff = await member("staff", nursingId);
  viewer = await member("viewer");
  await submitDemoAssessment(qm, tenant.facility.id, frameworkId);
  findings = await listFindings(qm, tenant.facility.id);
  ({ versionId: documentVersionId } = await approvedDemoDocument(qm, tenant.facility.id));
});

afterAll(disconnectDb);

describe("findings list", () => {
  it("lists every finding, open with no actions yet", () => {
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.status === "open" && f.capa.total === 0)).toBe(true);
  });

  it("filters by status and severity", async () => {
    expect(await listFindings(qm, tenant.facility.id, { severity: "esr" })).toHaveLength(1);
    expect(await listFindings(qm, tenant.facility.id, { status: "closed" })).toHaveLength(0);
  });

  it("offers members who can work as owners, not viewers", async () => {
    const owners = await listCapaOwners(qm, tenant.facility.id);
    expect(owners.map((o) => o.userId)).toEqual(
      expect.arrayContaining([qm.userId, staff.userId, nursingHead.userId]),
    );
    expect(owners.map((o) => o.userId)).not.toContain(viewer.userId);
  });
});

describe("planning an action", () => {
  it.each([
    ["a due date in the past", () => ({ who: qm, dueOn: day(-1), owner: staff }), "dueInPast"],
    ["a viewer as owner", () => ({ who: qm, dueOn: day(7), owner: viewer }), "unknownOwner"],
    ["staff cannot plan", () => ({ who: staff, dueOn: day(7), owner: staff }), "forbidden"],
    [
      "a department head cannot plan on a facility-wide finding",
      () => ({ who: nursingHead, dueOn: day(7), owner: staff }),
      "forbidden",
    ],
  ])("refuses %s", async (_name, setup, code) => {
    const { who, dueOn, owner } = setup();
    expect(
      await codeOf(
        createCapaItem(who, findingOn("3").id, {
          action: "Retrain",
          ownerUserId: owner.userId,
          dueOn,
        }),
      ),
    ).toBe(code);
  });

  it("refuses an owner from outside the facility", async () => {
    const outsider = await createUser(uniqueEmail("outsider"));
    expect(
      await codeOf(
        createCapaItem(qm, findingOn("3").id, {
          action: "Retrain",
          ownerUserId: outsider.id,
          dueOn: day(7),
        }),
      ),
    ).toBe("unknownOwner");
  });
});

describe("an action from plan to verified closure", () => {
  let itemId: string;

  it("creates the action, moves the finding to in progress, and audits both", async () => {
    ({ id: itemId } = await createCapaItem(qm, findingOn("3").id, {
      action: "  Retrain the nursing team on the demo checklist.  ",
      ownerUserId: staff.userId,
      dueOn: day(10),
    }));
    const finding = (await getFinding(qm, findingOn("3").id))!;
    expect(finding.status).toBe("in_progress");
    expect(finding.capaItems).toMatchObject([
      {
        action: "Retrain the nursing team on the demo checklist.",
        ownerUserId: staff.userId,
        ownerName: "Demo staff",
        status: "open",
        dueOn: day(10),
        overdue: false,
        escalation: 0,
      },
    ]);
    const [created] = await listAuditEvents(tenant.ctx, { entity: "capa_item", entityId: itemId });
    expect(created).toMatchObject({ action: "create", actorUserId: qm.userId });
    const [moved] = await listAuditEvents(tenant.ctx, {
      entity: "finding",
      entityId: findingOn("3").id,
    });
    expect(moved).toMatchObject({ before: { status: "open" }, after: { status: "in_progress" } });
  });

  it("shows the owner the action and its finding, though it is outside their department", async () => {
    expect((await listMyCapaItems(staff, tenant.facility.id)).map((i) => i.id)).toEqual([itemId]);
    const view = (await getFinding(staff, findingOn("3").id))!;
    expect(view.canPlan).toBe(false);
    expect(view.capaItems[0]!.allowed).toEqual({
      start: true,
      complete: true,
      cancel: false,
      reopen: false,
    });
    expect((await listFindings(staff, tenant.facility.id)).map((f) => f.id)).toEqual([
      findingOn("3").id,
    ]);
    // The other findings stay hidden from them.
    expect(await getFinding(staff, findingOn("1").id)).toBeNull();
  });

  it("lets the owner start it but not cancel it", async () => {
    expect(await transitionCapaItem(staff, itemId, { transition: "start" })).toMatchObject({
      status: "in_progress",
    });
    expect(
      await codeOf(transitionCapaItem(staff, itemId, { transition: "cancel", note: "x" })),
    ).toBe("forbidden");
  });

  it("will not mark it done without evidence and a note (anti-decoration)", async () => {
    expect(
      await codeOf(transitionCapaItem(staff, itemId, { transition: "complete", note: "Done" })),
    ).toBe("evidenceRequired");
    expect(
      await codeOf(addCapaEvidence(staff, itemId, { kind: "link", url: "ftp://x.test" })),
    ).toBe("invalidUrl");
    expect(
      await codeOf(
        addCapaEvidence(staff, itemId, {
          kind: "document",
          documentVersionId: crypto.randomUUID(),
        }),
      ),
    ).toBe("documentNotCitable");
    const { id: link } = await addCapaEvidence(staff, itemId, {
      kind: "link",
      url: "https://intranet.example.test/training",
    });
    await removeCapaEvidence(staff, link);
    await addCapaEvidence(staff, itemId, {
      kind: "document",
      documentVersionId,
      description: "Signed training record",
    });
    expect(await codeOf(transitionCapaItem(staff, itemId, { transition: "complete" }))).toBe(
      "closureNoteRequired",
    );
  });

  it("closes the action and, with it, the finding", async () => {
    expect(
      await transitionCapaItem(staff, itemId, {
        transition: "complete",
        note: "Twelve nurses retrained; five records audited.",
      }),
    ).toEqual({ status: "done", findingStatus: "closed" });
    const finding = (await getFinding(qm, findingOn("3").id))!;
    expect(finding.status).toBe("closed");
    expect(finding.closedAt).toBeInstanceOf(Date);
    expect(finding.capaItems[0]).toMatchObject({
      status: "done",
      closedBy: staff.userId,
      closureNote: "Twelve nurses retrained; five records audited.",
    });
    expect(finding.capaItems[0]!.evidence[0]!.documentVersion?.id).toBe(documentVersionId);
    expect(await listMyCapaItems(staff, tenant.facility.id)).toEqual([]);
    const [done] = await listAuditEvents(tenant.ctx, { entity: "capa_item", entityId: itemId });
    expect(done).toMatchObject({
      action: "complete",
      after: { status: "done", evidence: 1, closedByOwner: true },
    });
  });

  it("freezes the evidence of a done action", async () => {
    const evidenceId = (await getFinding(qm, findingOn("3").id))!.capaItems[0]!.evidence[0]!.id;
    expect(await codeOf(removeCapaEvidence(staff, evidenceId))).toBe("itemClosed");
    expect(
      await codeOf(addCapaEvidence(staff, itemId, { kind: "link", url: "https://x.test" })),
    ).toBe("itemClosed");
  });

  it("reopens only with a reason, which reopens the finding", async () => {
    expect(await codeOf(transitionCapaItem(qm, itemId, { transition: "reopen" }))).toBe(
      "reasonRequired",
    );
    expect(
      await transitionCapaItem(qm, itemId, {
        transition: "reopen",
        note: "The audit sample was too small.",
      }),
    ).toEqual({ status: "in_progress", findingStatus: "in_progress" });
    expect((await getFinding(qm, findingOn("3").id))!.closedAt).toBeNull();
    // A planner may close it on the owner's behalf; the audit says so.
    await transitionCapaItem(qm, itemId, {
      transition: "complete",
      note: "Ten more records audited.",
    });
    const [done] = await listAuditEvents(tenant.ctx, { entity: "capa_item", entityId: itemId });
    expect(done).toMatchObject({ after: { closedByOwner: false } });
  });

  it("is verified by a later assessment that scores the element fully met", async () => {
    const assessmentId = await startAssessment(qm, tenant.facility.id, { frameworkId });
    const sheet = (await getAssessmentSheet(qm, assessmentId))!;
    for (const element of sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements))) {
      await saveElementScore(qm, assessmentId, element.id, {
        levelCode: element.code.endsWith(".2") ? "PM" : "MET",
        evidence: { kind: "observation", note: "Seen on the ward." },
      });
    }
    expect(await submitAssessment(qm, assessmentId)).toMatchObject({ verified: 1 });

    const verified = (await getFinding(qm, findingOn("3").id))!;
    expect(verified).toMatchObject({ status: "verified", canPlan: false });
    expect(verified.verifiedScore?.assessmentId).toBe(assessmentId);
    // Findings that were never closed are not verified by a good score.
    expect((await getFinding(qm, findingOn("1").id))!.status).toBe("open");
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "finding",
      entityId: findingOn("3").id,
    });
    expect(event).toMatchObject({ action: "approve", after: { status: "verified" } });
  });

  it("settles a verified finding: no reopening, no new actions", async () => {
    expect(await codeOf(transitionCapaItem(qm, itemId, { transition: "reopen", note: "x" }))).toBe(
      "findingVerified",
    );
    expect(
      await codeOf(
        createCapaItem(qm, findingOn("3").id, {
          action: "More",
          ownerUserId: qm.userId,
          dueOn: day(3),
        }),
      ),
    ).toBe("findingVerified");
  });
});

describe("cancelling and rescheduling", () => {
  it("cancels with a reason; a finding with only cancelled actions is open again", async () => {
    const { id } = await createCapaItem(qm, findingOn("2").id, {
      action: "Replace the fridge",
      ownerUserId: qm.userId,
      dueOn: day(5),
    });
    expect(await codeOf(transitionCapaItem(qm, id, { transition: "cancel" }))).toBe(
      "reasonRequired",
    );
    expect(
      await transitionCapaItem(qm, id, { transition: "cancel", note: "Duplicate of another plan" }),
    ).toEqual({ status: "cancelled", findingStatus: "open" });
  });

  it("moves a due date with a reason, and audits the old and new dates", async () => {
    const { id } = await createCapaItem(qm, findingOn("2").id, {
      action: "Label the shelves",
      ownerUserId: staff.userId,
      dueOn: day(5),
    });
    expect(await codeOf(rescheduleCapaItem(qm, id, { dueOn: day(9) }))).toBe("reasonRequired");
    expect(await codeOf(rescheduleCapaItem(staff, id, { dueOn: day(9), reason: "Busy" }))).toBe(
      "forbidden",
    );
    await rescheduleCapaItem(qm, id, { dueOn: day(9), reason: "Supplier delay" });
    const [event] = await listAuditEvents(tenant.ctx, { entity: "capa_item", entityId: id });
    expect(event).toMatchObject({
      action: "update",
      before: { dueOn: day(5) },
      after: { dueOn: day(9), reason: "Supplier delay" },
    });
  });
});

describe("overdue actions and escalation", () => {
  it("escalates by days overdue and counts toward readiness", async () => {
    const past = new Date(Date.now() - 20 * 86_400_000);
    const { id } = await createCapaItem(
      qm,
      findingOn("1").id,
      { action: "Fix the ESR gap", ownerUserId: qm.userId, dueOn: day(1, past) },
      past,
    );
    const item = (await getFinding(qm, findingOn("1").id))!.capaItems.find((i) => i.id === id)!;
    expect(item).toMatchObject({ overdue: true, escalation: 3 });
    const at = (offset: number) => new Date(Date.now() + offset * 86_400_000);
    expect(await countOverdueCapa(qm, tenant.facility.id)).toBe(1);
    // The other open action (due in 9 days) is overdue too a fortnight from now.
    expect(await countOverdueCapa(qm, tenant.facility.id, at(14))).toBe(2);
    const readiness = await getReadiness(qm, tenant.facility.id);
    expect(readiness[0]!.overdueCapa).toBe(1);
  });
});

describe("department scope", () => {
  it("lets a department head plan on their own department's findings", async () => {
    const assessmentId = await startAssessment(nursingHead, tenant.facility.id, {
      frameworkId,
      departmentId: nursingId,
    });
    const sheet = (await getAssessmentSheet(nursingHead, assessmentId))!;
    for (const element of sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements))) {
      await saveElementScore(nursingHead, assessmentId, element.id, {
        levelCode: "NM",
        comment: "Not yet.",
      });
    }
    await submitAssessment(nursingHead, assessmentId);
    const [own] = await listFindings(nursingHead, tenant.facility.id, { assessmentId });
    expect(own?.departmentId).toBe(nursingId);
    const { id } = await createCapaItem(nursingHead, own!.id, {
      action: "Ward checklist",
      ownerUserId: staff.userId,
      dueOn: day(3),
    });
    expect((await getFinding(staff, own!.id))?.capaItems.map((i) => i.id)).toEqual([id]);
  });
});

describe("database guards", () => {
  it("refuses to mark an action done without evidence, even past the service", async () => {
    const { id } = await createCapaItem(qm, findingOn("1").id, {
      action: "Direct write",
      ownerUserId: qm.userId,
      dueOn: day(2),
    });
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`UPDATE capa_item SET status = 'done', closed_at = now(), closure_note = 'x'
            WHERE id = ${id}::uuid`,
      ),
    ).rejects.toThrow(/closure evidence/);
  });

  it("refuses a verified finding without the score that proved it", async () => {
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`UPDATE finding SET status = 'verified', closed_at = now(), verified_at = now()
            WHERE id = ${findingOn("2").id}::uuid`,
      ),
    ).rejects.toThrow(/finding_closure_consistent/);
  });
});
