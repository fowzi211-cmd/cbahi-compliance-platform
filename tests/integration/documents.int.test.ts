import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withTenant } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { memoryObjects } from "@/lib/storage";
import {
  getAssessmentSheet,
  saveElementScore,
  startAssessment,
} from "@/modules/assessments/service";
import { listAuditEvents } from "@/modules/audit/service";
import {
  PhiDetectedError,
  createDocument,
  decideVersion,
  getDocument,
  getDownloadUrl,
  listCitableVersions,
  listDocuments,
  maxUploadBytes,
  retireDocument,
  setElementLink,
  uploadVersion,
  type DocumentInput,
} from "@/modules/documents/service";
import { makeDocx, makePdf } from "@/modules/documents/test-files";
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
  uniqueEmail,
} from "./helpers";

// M8: document control with fictional files only.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let facilityId: string;
let frameworkId: string;
let nursingId: string;
let qm: AccessContext;
let nursingHead: AccessContext;
let staff: AccessContext;

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

const pdf = (...lines: string[]) => makePdf([...lines, `Fictional ${crypto.randomUUID()}`]);
const policy = (overrides: Partial<DocumentInput> = {}): DocumentInput => ({
  type: "policy",
  titleAr: "سياسة تجريبية",
  file: { name: "policy.pdf", bytes: pdf("Demo policy") },
  phiAttested: true,
  ...overrides,
});

async function member(
  role: "quality_manager" | "department_head" | "staff",
  departmentId?: string,
) {
  const user = await createUser(uniqueEmail(role));
  await addMembership(tenant.ctx, {
    userId: user.id,
    facilityId,
    role,
    ...(departmentId ? { departmentId } : {}),
  });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

beforeAll(async () => {
  tenant = await makeTenant("Documents");
  facilityId = tenant.facility.id;
  ({ frameworkId } = await publishDemoEdition({ elements: ["1", "2", "3"], esr: [] }));
  await setFacilityFrameworks(tenant.ctx, facilityId, [frameworkId]);
  nursingId = (
    await createDepartment(tenant.ctx, {
      facilityId,
      nameAr: "التمريض",
      nameEn: "Nursing",
      typeCode: "nursing",
    })
  ).id;
  qm = await member("quality_manager");
  nursingHead = await member("department_head", nursingId);
  staff = await member("staff", nursingId);
});

afterAll(disconnectDb);

describe("uploading", () => {
  it("stores the file under the tenant and facility, waiting for review, and audits it", async () => {
    const before = memoryObjects.size;
    const { documentId, versionId } = await createDocument(staff, facilityId, policy());
    expect(memoryObjects.size).toBe(before + 1);
    const document = (await getDocument(staff, documentId))!;
    expect(document.versions).toMatchObject([
      {
        id: versionId,
        version: 1,
        status: "in_review",
        state: "pending",
        contentType: "application/pdf",
        phiScan: { scanned: true, hits: [] },
        phiOverride: false,
      },
    ]);
    const url = (await getDownloadUrl(staff, versionId))!;
    expect(url).toMatch(
      new RegExp(
        `^memory://tenants/${tenant.tenant.id}/facilities/${facilityId}/documents/${documentId}/${versionId}\\?expires=300$`,
      ),
    );
    const events = await listAuditEvents(tenant.ctx, {
      entity: "document_version",
      entityId: versionId,
    });
    expect(events[0]).toMatchObject({ action: "create" });
  });

  it.each([
    ["without the no-patient-data attestation", { phiAttested: false }, "phiAttestationRequired"],
    ["an empty file", { file: { name: "a.pdf", bytes: new Uint8Array() } }, "emptyFile"],
    [
      "a file over the limit",
      { file: { name: "a.pdf", bytes: new Uint8Array(maxUploadBytes + 1) } },
      "fileTooLarge",
    ],
    [
      "HTML named .pdf",
      { file: { name: "a.pdf", bytes: new TextEncoder().encode("<html>") } },
      "unsupportedFileType",
    ],
    ["no title", { titleAr: "", titleEn: " " }, "titleRequired"],
    [
      "review before it takes effect",
      { effectiveOn: "2026-05-01", reviewOn: "2026-04-01" },
      "reviewBeforeEffective",
    ],
  ] as const)("refuses %s, storing nothing", async (_, overrides, code) => {
    const before = memoryObjects.size;
    expect(await codeOf(createDocument(qm, facilityId, policy(overrides)))).toBe(code);
    expect(memoryObjects.size).toBe(before);
  });

  it("stops a file that looks like patient data, unless the uploader confirms it is not", async () => {
    const before = memoryObjects.size;
    const file = {
      name: "form.docx",
      bytes: await makeDocx(["Sample form", "MRN: 123456", "DOB: 01/02/1990"]),
    };
    const refused = await createDocument(qm, facilityId, policy({ file })).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PhiDetectedError);
    expect((refused as PhiDetectedError).hits).toEqual([
      { kind: "medicalRecordNumber", count: 1 },
      { kind: "dateOfBirth", count: 1 },
    ]);
    expect(memoryObjects.size).toBe(before);

    const { versionId } = await createDocument(
      qm,
      facilityId,
      policy({ file, phiConfirmed: true }),
    );
    const [override] = await listAuditEvents(tenant.ctx, {
      entity: "phi_override",
      entityId: versionId,
    });
    // The audit says which kinds matched, never the matched text.
    expect(override?.after).toEqual({
      hits: [
        { kind: "medicalRecordNumber", count: 1 },
        { kind: "dateOfBirth", count: 1 },
      ],
    });
    expect(JSON.stringify(override)).not.toContain("123456");
  });

  it("lets a department head file documents for their own department only", async () => {
    expect(await codeOf(createDocument(nursingHead, facilityId, policy()))).toBe("forbidden");
    const { documentId } = await createDocument(
      nursingHead,
      facilityId,
      policy({ departmentId: nursingId }),
    );
    expect((await getDocument(staff, documentId))?.department?.nameEn).toBe("Nursing");
  });
});

describe("approval, versions and citing", () => {
  let documentId: string;
  let v1: string;
  let elementId: string;

  beforeAll(async () => {
    ({ documentId, versionId: v1 } = await createDocument(
      qm,
      facilityId,
      policy({
        reviewOn: "2027-01-01",
        expiresOn: "2027-06-30",
      }),
    ));
    const assessmentId = await startAssessment(qm, facilityId, { frameworkId });
    elementId = (await getAssessmentSheet(qm, assessmentId))!.chapters[0]!.standards[0]!
      .elements[0]!.id;
  });

  it("is decided by an approver, and a rejection says why", async () => {
    expect(await codeOf(decideVersion(staff, v1, { decision: "approved" }))).toBe("forbidden");
    expect(await codeOf(decideVersion(qm, v1, { decision: "rejected" }))).toBe("commentRequired");
    expect(await decideVersion(qm, v1, { decision: "approved" })).toEqual({ status: "approved" });
    expect(await codeOf(decideVersion(qm, v1, { decision: "approved" }))).toBe("notInReview");
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "document_version",
      entityId: v1,
      limit: 1,
    });
    expect(event).toMatchObject({ action: "approve", after: { selfApproved: true } });
  });

  it("links the document to an element of the facility's framework", async () => {
    expect(await codeOf(setElementLink(qm, documentId, crypto.randomUUID(), true))).toBe(
      "unknownElement",
    );
    await setElementLink(qm, documentId, elementId, true);
    await setElementLink(qm, documentId, elementId, true);
    expect((await getDocument(qm, documentId))!.elements.map((e) => e.id)).toEqual([elementId]);
    const citable = await listCitableVersions(qm, facilityId);
    expect(citable.find((c) => c.versionId === v1)?.elementIds).toEqual([elementId]);
  });

  it("is cited in a score; versions not approved or expired are refused", async () => {
    const assessmentId = await startAssessment(qm, facilityId, { frameworkId });
    const saved = await saveElementScore(qm, assessmentId, elementId, {
      levelCode: "MET",
      evidence: { kind: "document", documentVersionId: v1 },
    });
    const sheet = (await getAssessmentSheet(qm, assessmentId))!;
    const evidence = sheet.chapters[0]!.standards[0]!.elements[0]!.score!.evidence[0]!;
    expect(evidence.documentVersion).toMatchObject({
      id: v1,
      version: 1,
      document: { id: documentId },
    });
    expect(saved.evidenceId).toBeTruthy();

    const pending = await createDocument(qm, facilityId, policy());
    expect(
      await codeOf(
        saveElementScore(qm, assessmentId, elementId, {
          levelCode: "MET",
          evidence: { kind: "document", documentVersionId: pending.versionId },
        }),
      ),
    ).toBe("documentNotCitable");
    // After its expiry date the version no longer counts as evidence.
    expect(
      (await listCitableVersions(qm, facilityId, new Date("2027-07-02T00:00:00Z"))).some(
        (c) => c.versionId === v1,
      ),
    ).toBe(false);
    expect(
      (await listCitableVersions(qm, facilityId, new Date("2027-03-01T00:00:00Z"))).some(
        (c) => c.versionId === v1,
      ),
    ).toBe(true);
  });

  it("takes a new version through review; the old one stays in force until then", async () => {
    const same = (await getDocument(qm, documentId))!;
    expect(same.versions[0]!.state).toBe("current");
    const v2 = await uploadVersion(qm, documentId, {
      file: { name: "policy-v2.pdf", bytes: pdf("Demo policy, second issue") },
      changeNote: "Added the weekend check.",
      phiAttested: true,
    });
    expect(v2.version).toBe(2);
    expect(
      await codeOf(
        uploadVersion(qm, documentId, {
          file: { name: "x.pdf", bytes: pdf("third") },
          phiAttested: true,
        }),
      ),
    ).toBe("versionPending");
    expect((await listCitableVersions(qm, facilityId)).map((c) => c.versionId)).toContain(v1);

    await decideVersion(qm, v2.versionId, { decision: "approved" });
    const after = (await getDocument(qm, documentId))!;
    expect(after.versions.map((v) => [v.version, v.status])).toEqual([
      [2, "approved"],
      [1, "superseded"],
    ]);
    const citable = (await listCitableVersions(qm, facilityId)).map((c) => c.versionId);
    expect(citable).toContain(v2.versionId);
    expect(citable).not.toContain(v1);
  });

  it("refuses the same file twice in one document", async () => {
    const bytes = pdf("Same bytes");
    const { documentId: id, versionId } = await createDocument(
      qm,
      facilityId,
      policy({ file: { name: "a.pdf", bytes } }),
    );
    await decideVersion(qm, versionId, { decision: "approved" });
    expect(
      await codeOf(uploadVersion(qm, id, { file: { name: "b.pdf", bytes }, phiAttested: true })),
    ).toBe("duplicateFile");
  });

  it("retires a document: it stays on record but can no longer be cited or revised", async () => {
    const { documentId: id, versionId } = await approvedDemoDocument(qm, facilityId, "To retire");
    await retireDocument(qm, id);
    expect((await listCitableVersions(qm, facilityId)).some((c) => c.versionId === versionId)).toBe(
      false,
    );
    expect(
      await codeOf(
        uploadVersion(qm, id, { file: { name: "r.pdf", bytes: pdf("r") }, phiAttested: true }),
      ),
    ).toBe("documentRetired");
    expect(
      (await listDocuments(staff, facilityId)).find((d) => d.id === id)?.retiredAt,
    ).toBeTruthy();
  });

  it("keeps a version's file and decisions unchangeable in the database", async () => {
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`UPDATE document_version SET file_name = 'x.pdf' WHERE id = ${v1}::uuid`,
      ),
    ).rejects.toThrow(/cannot change/);
    await expect(
      withTenant(qm, (tx) => tx.$executeRaw`DELETE FROM document_version WHERE id = ${v1}::uuid`),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`UPDATE document_approval SET comment = 'x' WHERE version_id = ${v1}::uuid`,
      ),
    ).rejects.toThrow(/cannot be changed/);
  });
});
