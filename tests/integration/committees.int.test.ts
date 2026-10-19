import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withTenant } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { memoryObjects } from "@/lib/storage";
import { saveElementScore, startAssessment } from "@/modules/assessments/service";
import { listAuditEvents } from "@/modules/audit/service";
import {
  archiveCommittee,
  createCommittee,
  deleteMeeting,
  fileMinutes,
  getCommittee,
  getCommitteeOptions,
  listCommittees,
  recordMeeting,
  setCommitteeElement,
  updateCommittee,
  type MinutesInput,
} from "@/modules/committees/service";
import {
  PhiDetectedError,
  createDocument,
  decideVersion,
  getDocument,
  listCitableVersions,
} from "@/modules/documents/service";
import { makePdf } from "@/modules/documents/test-files";
import { setFacilityFrameworks } from "@/modules/standards/service";
import { addMembership, loadAccessContext, type AccessContext } from "@/modules/tenancy/service";
import { createUser, makeTenant, publishDemoEdition, uniqueEmail } from "./helpers";

// M12: committees, meetings, and minutes filed as documents that become evidence on the
// elements the committee oversees.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let facilityId: string;
let frameworkId: string;
let elementIds: string[];
let qm: AccessContext;
let staff: AccessContext;
let viewer: AccessContext;

const now = new Date("2026-10-19T09:00:00Z");

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

const minutes = (overrides: Partial<MinutesInput> = {}): MinutesInput => ({
  titleAr: "محضر لجنة تجريبية",
  file: { name: "minutes.pdf", bytes: makePdf(["Demo minutes", crypto.randomUUID()]) },
  phiAttested: true,
  ...overrides,
});

async function member(role: "quality_manager" | "staff" | "viewer") {
  const user = await createUser(uniqueEmail(role), `Demo ${role}`);
  await addMembership(tenant.ctx, { userId: user.id, facilityId, role });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

beforeAll(async () => {
  tenant = await makeTenant("Committees");
  facilityId = tenant.facility.id;
  ({ frameworkId } = await publishDemoEdition({ elements: ["1", "2", "3"], esr: [] }));
  await setFacilityFrameworks(tenant.ctx, facilityId, [frameworkId]);
  qm = await member("quality_manager");
  staff = await member("staff");
  viewer = await member("viewer");
  elementIds = (await getCommitteeOptions(qm, facilityId))!.elements.map((e) => e.id);
});

afterAll(disconnectDb);

describe("committees", () => {
  let committeeId: string;

  it("lets the owner and quality manager create one; others may only read", async () => {
    expect(await getCommitteeOptions(staff, facilityId)).toBeNull();
    expect(
      await codeOf(createCommittee(staff, facilityId, { nameEn: "X", frequency: "monthly" })),
    ).toBe("forbidden");
    expect(await codeOf(createCommittee(qm, facilityId, { frequency: "monthly" }))).toBe(
      "nameRequired",
    );
    expect(
      await codeOf(
        createCommittee(qm, facilityId, {
          nameEn: "X",
          frequency: "monthly",
          chairUserId: crypto.randomUUID(),
        }),
      ),
    ).toBe("unknownChair");

    committeeId = await createCommittee(
      qm,
      facilityId,
      { nameAr: "لجنة الجودة التجريبية", frequency: "quarterly", chairUserId: staff.userId },
      now,
    );
    const { committees, canManage } = await listCommittees(viewer, facilityId, now);
    expect(canManage).toBe(false);
    expect(committees).toEqual([
      expect.objectContaining({
        id: committeeId,
        chairName: "Demo staff",
        frequency: "quarterly",
        lastHeldOn: null,
        dueOn: "2027-01-19",
        dueState: "onTrack",
        meetingCount: 0,
      }),
    ]);
    expect((await listCommittees(qm, facilityId, now)).canManage).toBe(true);
  });

  it("is edited and audited with what changed", async () => {
    expect(
      await codeOf(updateCommittee(staff, committeeId, { nameEn: "X", frequency: "monthly" })),
    ).toBe("forbidden");
    await updateCommittee(qm, committeeId, {
      nameAr: "لجنة الجودة التجريبية",
      nameEn: "Demo quality committee",
      frequency: "monthly",
    });
    const committee = (await getCommittee(viewer, committeeId, now))!;
    expect(committee).toMatchObject({
      nameEn: "Demo quality committee",
      frequency: "monthly",
      chairUserId: null,
      dueOn: "2026-11-19",
      canManage: false,
    });
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "committee",
      entityId: committeeId,
      limit: 1,
    });
    expect(event).toMatchObject({
      action: "update",
      before: { frequency: "quarterly", chairUserId: staff.userId },
      after: { frequency: "monthly", chairUserId: null },
    });
  });

  it("oversees elements of the facility's editions only", async () => {
    expect(await codeOf(setCommitteeElement(qm, committeeId, crypto.randomUUID(), true))).toBe(
      "unknownElement",
    );
    expect(await codeOf(setCommitteeElement(staff, committeeId, elementIds[0]!, true))).toBe(
      "forbidden",
    );
    await setCommitteeElement(qm, committeeId, elementIds[0]!, true);
    await setCommitteeElement(qm, committeeId, elementIds[0]!, true);
    await setCommitteeElement(qm, committeeId, elementIds[1]!, true);
    await setCommitteeElement(qm, committeeId, elementIds[1]!, false);
    expect((await getCommittee(qm, committeeId))!.elements.map((e) => e.id)).toEqual([
      elementIds[0],
    ]);
  });

  it("is archived, after which it is gone from the list but its record stays", async () => {
    const id = await createCommittee(qm, facilityId, { nameEn: "Temp", frequency: "annual" });
    await archiveCommittee(qm, id, now);
    expect((await listCommittees(qm, facilityId)).committees.map((c) => c.id)).not.toContain(id);
    expect(await getCommittee(qm, id)).toBeNull();
    expect(await codeOf(recordMeeting(qm, id, { heldOn: "2026-10-01" }, now))).toBe("notFound");
  });

  describe("meetings and minutes", () => {
    let meetingId: string;

    it("records meetings that took place, one a day, and moves the next due date", async () => {
      expect(await codeOf(recordMeeting(qm, committeeId, { heldOn: "2026-10-20" }, now))).toBe(
        "meetingInFuture",
      );
      expect(await codeOf(recordMeeting(staff, committeeId, { heldOn: "2026-10-01" }, now))).toBe(
        "forbidden",
      );
      meetingId = await recordMeeting(qm, committeeId, { heldOn: "2026-10-19" }, now);
      expect(await codeOf(recordMeeting(qm, committeeId, { heldOn: "2026-10-19" }, now))).toBe(
        "meetingExists",
      );
      const committee = (await getCommittee(qm, committeeId, now))!;
      expect(committee).toMatchObject({ lastHeldOn: "2026-10-19", dueOn: "2026-11-19" });
      expect(committee.meetings).toEqual([
        { id: meetingId, heldOn: "2026-10-19", minutesDocumentId: null, minutes: "missing" },
      ]);
    });

    it("deletes a meeting entered by mistake", async () => {
      const id = await recordMeeting(qm, committeeId, { heldOn: "2026-09-01" }, now);
      expect(await codeOf(deleteMeeting(staff, id))).toBe("forbidden");
      await deleteMeeting(qm, id);
      expect((await getCommittee(qm, committeeId))!.meetings.map((m) => m.id)).toEqual([meetingId]);
    });

    it("refuses minutes with patient data and keeps nothing", async () => {
      const before = memoryObjects.size;
      const refused = await fileMinutes(
        qm,
        meetingId,
        minutes({
          file: {
            name: "m.pdf",
            bytes: makePdf(["Demo minutes", "MRN: 0001234", "DOB: 1990-01-01"]),
          },
        }),
      ).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(PhiDetectedError);
      expect(memoryObjects.size).toBe(before);
      expect((await getCommittee(qm, committeeId))!.meetings[0]!.minutes).toBe("missing");
    });

    it("files minutes as a document linked to the overseen elements, once", async () => {
      expect(await codeOf(fileMinutes(staff, meetingId, minutes()))).toBe("forbidden");
      const documentId = await fileMinutes(qm, meetingId, minutes(), now);
      const document = (await getDocument(qm, documentId))!;
      expect(document).toMatchObject({ type: "minutes", departmentId: null });
      expect(document.versions[0]).toMatchObject({
        status: "in_review",
        effectiveOn: "2026-10-19",
      });
      expect(document.elements.map((e) => e.id)).toEqual([elementIds[0]]);
      expect((await getCommittee(qm, committeeId))!.meetings[0]).toMatchObject({
        minutesDocumentId: documentId,
        minutes: "inReview",
      });

      const before = memoryObjects.size;
      expect(await codeOf(fileMinutes(qm, meetingId, minutes()))).toBe("minutesExist");
      expect(memoryObjects.size).toBe(before);
      expect(await codeOf(deleteMeeting(qm, meetingId))).toBe("minutesExist");
    });

    it("counts approved minutes as evidence on the overseen elements", async () => {
      const { minutesDocumentId } = (await getCommittee(qm, committeeId))!.meetings[0]!;
      const versionId = (await getDocument(qm, minutesDocumentId!))!.versions[0]!.id;
      expect((await listCitableVersions(qm, facilityId)).map((c) => c.versionId)).not.toContain(
        versionId,
      );
      await decideVersion(qm, versionId, { decision: "approved" });
      expect((await getCommittee(qm, committeeId))!.meetings[0]!.minutes).toBe("approved");
      const citable = (await listCitableVersions(qm, facilityId)).find(
        (c) => c.versionId === versionId,
      );
      expect(citable?.elementIds).toEqual([elementIds[0]]);

      const assessmentId = await startAssessment(qm, facilityId, { frameworkId });
      await expect(
        saveElementScore(qm, assessmentId, elementIds[0]!, {
          levelCode: "MET",
          evidence: { kind: "document", documentVersionId: versionId },
        }),
      ).resolves.toMatchObject({ evidenceId: expect.any(String) });
    });

    it("keeps filed minutes on their meeting in the database itself", async () => {
      await expect(
        withTenant(tenant.ctx, (tx) =>
          tx.meeting.update({ where: { id: meetingId }, data: { minutesDocumentId: null } }),
        ),
      ).rejects.toThrow(/cannot change/);
      await expect(
        withTenant(tenant.ctx, (tx) => tx.meeting.delete({ where: { id: meetingId } })),
      ).rejects.toThrow(/cannot be deleted/);
    });

    it("refuses another meeting's minutes, or a document that is not minutes", async () => {
      const id = await recordMeeting(qm, committeeId, { heldOn: "2026-08-01" }, now);
      const { minutesDocumentId } = (await getCommittee(qm, committeeId))!.meetings[0]!;
      const { documentId: policyId } = await createDocument(qm, facilityId, {
        type: "policy",
        titleEn: "Demo policy",
        file: { name: "p.pdf", bytes: makePdf(["Demo policy", crypto.randomUUID()]) },
        phiAttested: true,
      });
      for (const documentId of [minutesDocumentId!, policyId]) {
        await expect(
          withTenant(tenant.ctx, (tx) =>
            tx.meeting.update({ where: { id }, data: { minutesDocumentId: documentId } }),
          ),
        ).rejects.toThrow();
      }
      await expect(
        withTenant(tenant.ctx, (tx) =>
          tx.meeting.update({ where: { id }, data: { minutesDocumentId: policyId } }),
        ),
      ).rejects.toThrow(/must be a minutes document/);
    });
  });
});
