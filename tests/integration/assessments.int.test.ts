import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withTenant } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import {
  getAssessmentSheet,
  getReadiness,
  getStartOptions,
  listAssessments,
  removeEvidence,
  saveElementScore,
  startAssessment,
  submitAssessment,
  type AssessmentSheet,
} from "@/modules/assessments/service";
import { listAuditEvents } from "@/modules/audit/service";
import { listFindings } from "@/modules/findings/service";
import { decideApplicability, setFacilityFrameworks } from "@/modules/standards/service";
import {
  addMembership,
  createDepartment,
  loadAccessContext,
  type AccessContext,
} from "@/modules/tenancy/service";
import { createUser, makeTenant, publishDemoEdition, uniqueEmail } from "./helpers";

// M7: self-assessment against a fictional edition. Elements 1 and 2 are ESR; 2 and 3 belong
// to nursing, 4 to pharmacy, 1 and 5 are facility-wide.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let frameworkId: string;
let nursingId: string;
let untypedId: string;
let qm: AccessContext;
let nursingHead: AccessContext;
let staff: AccessContext;
const element = new Map<string, string>();

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

const elementsOf = (sheet: AssessmentSheet) =>
  sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements));

async function member(
  role: "quality_manager" | "department_head" | "staff",
  departmentId?: string,
) {
  const user = await createUser(uniqueEmail(role));
  await addMembership(tenant.ctx, {
    userId: user.id,
    facilityId: tenant.facility.id,
    role,
    ...(departmentId ? { departmentId } : {}),
  });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

beforeAll(async () => {
  tenant = await makeTenant("Assessments");
  ({ frameworkId } = await publishDemoEdition({
    elements: ["1", "2", "3", "4", "5"],
    esr: ["1", "2"],
    departmentTypes: { "2": "nursing", "3": "nursing", "4": "pharmacy" },
  }));
  await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [frameworkId]);
  const facilityId = tenant.facility.id;
  nursingId = (
    await createDepartment(tenant.ctx, {
      facilityId,
      nameAr: "التمريض",
      nameEn: "Nursing",
      typeCode: "nursing",
    })
  ).id;
  untypedId = (
    await createDepartment(tenant.ctx, { facilityId, nameAr: "الإدارة", nameEn: "Admin" })
  ).id;
  qm = await member("quality_manager");
  nursingHead = await member("department_head", nursingId);
  staff = await member("staff", nursingId);

  const options = await getStartOptions(qm, facilityId);
  expect(options?.frameworks.map((f) => f.id)).toEqual([frameworkId]);
  const any = await startAssessment(qm, facilityId, { frameworkId });
  for (const e of elementsOf((await getAssessmentSheet(qm, any))!)) {
    element.set(e.code.split(".").pop()!, e.id);
  }
});

afterAll(disconnectDb);

describe("starting an assessment", () => {
  it("offers department heads only their own department", async () => {
    const options = (await getStartOptions(nursingHead, tenant.facility.id))!;
    expect(options.wholeFacility).toBe(false);
    expect(options.departments.map((d) => d.id)).toEqual([nursingId]);
    expect((await getStartOptions(staff, tenant.facility.id))?.departments).toEqual([]);
  });

  it.each([
    [
      "staff cannot",
      () => startAssessment(staff, tenant.facility.id, { frameworkId, departmentId: nursingId }),
      "forbidden",
    ],
    [
      "a department head cannot assess the whole facility",
      () => startAssessment(nursingHead, tenant.facility.id, { frameworkId }),
      "forbidden",
    ],
    [
      "an edition the facility does not use",
      () => startAssessment(qm, tenant.facility.id, { frameworkId: crypto.randomUUID() }),
      "unknownFramework",
    ],
    [
      "a department of no type has nothing to score",
      () => startAssessment(qm, tenant.facility.id, { frameworkId, departmentId: untypedId }),
      "nothingToScore",
    ],
    [
      "a department of another facility",
      () =>
        startAssessment(qm, tenant.facility.id, { frameworkId, departmentId: crypto.randomUUID() }),
      "unknownDepartment",
    ],
  ])("%s", async (_, run, code) => {
    expect(await codeOf(run())).toBe(code);
  });

  it("covers the department's elements only, and audits the start", async () => {
    const id = await startAssessment(nursingHead, tenant.facility.id, {
      frameworkId,
      departmentId: nursingId,
    });
    const sheet = (await getAssessmentSheet(nursingHead, id))!;
    expect(elementsOf(sheet).map((e) => e.code)).toEqual(["DEMO-X.1.2", "DEMO-X.1.3"]);
    expect(sheet.progress).toEqual({ total: 2, scored: 0 });
    expect(sheet.canScore).toBe(true);
    const [event] = await listAuditEvents(tenant.ctx, { entity: "assessment", entityId: id });
    expect(event).toMatchObject({ action: "create" });
    // Staff of the department can read it but not score it.
    expect((await getAssessmentSheet(staff, id))?.canScore).toBe(false);
  });

  it("covers every applicable element for the whole facility", async () => {
    await decideApplicability(tenant.ctx, tenant.facility.id, element.get("5")!, {
      applicable: false,
      justification: "This demo service is not offered here.",
    });
    const id = await startAssessment(qm, tenant.facility.id, { frameworkId });
    const sheet = (await getAssessmentSheet(qm, id))!;
    expect(elementsOf(sheet).map((e) => e.code)).toEqual([
      "DEMO-X.1.1",
      "DEMO-X.1.2",
      "DEMO-X.1.3",
      "DEMO-X.1.4",
    ]);
    // A department head never sees a facility-wide assessment.
    expect(await getAssessmentSheet(nursingHead, id)).toBeNull();
    expect(
      (await listAssessments(nursingHead, tenant.facility.id)).every(
        (a) => a.departmentId === nursingId,
      ),
    ).toBe(true);
  });
});

describe("scoring and submitting a department assessment", () => {
  let id: string;
  beforeAll(async () => {
    id = await startAssessment(nursingHead, tenant.facility.id, {
      frameworkId,
      departmentId: nursingId,
    });
  });

  it.each([
    ["Met needs evidence", "3", { levelCode: "MET" }, "evidenceRequired"],
    [
      "an ESR element cannot be partially met",
      "2",
      { levelCode: "PM", evidence: { kind: "observation", note: "seen" } },
      "esrLevelNotAllowed",
    ],
    ["N/A needs a comment", "3", { levelCode: "NA" }, "commentRequired"],
    [
      "a document needs a link",
      "3",
      { levelCode: "MET", evidence: { kind: "document", note: "policy" } },
      "documentRequired",
    ],
    [
      "a link must be a web link",
      "3",
      { levelCode: "MET", evidence: { kind: "document", url: "javascript:alert(1)" } },
      "invalidUrl",
    ],
    [
      "an observation needs a note",
      "3",
      { levelCode: "MET", evidence: { kind: "observation" } },
      "noteRequired",
    ],
    ["an unknown level", "3", { levelCode: "MAYBE" }, "unknownLevel"],
    ["an element outside the department", "4", { levelCode: "NM" }, "unknownElement"],
  ] as const)("refuses: %s", async (_, n, input, code) => {
    expect(await codeOf(saveElementScore(nursingHead, id, element.get(n)!, input))).toBe(code);
    // Nothing was kept from a refused save.
    expect((await getAssessmentSheet(nursingHead, id))!.progress.scored).toBe(0);
  });

  it("saves a score with its evidence, stamped with server time and audited", async () => {
    const saved = await saveElementScore(
      nursingHead,
      id,
      element.get("2")!,
      {
        levelCode: "MET",
        comment: "Double-check in place on both shifts.",
        evidence: { kind: "observation", note: "Observed two administrations." },
      },
      new Date("2026-10-01T08:00:00Z"),
    );
    const sheet = (await getAssessmentSheet(nursingHead, id))!;
    const scored = elementsOf(sheet).find((e) => e.id === element.get("2"))!;
    expect(scored.score).toMatchObject({
      levelCode: "MET",
      scoredAt: new Date("2026-10-01T08:00:00Z"),
      evidence: [{ kind: "observation", note: "Observed two administrations." }],
    });
    expect(sheet.progress).toEqual({ total: 2, scored: 1 });
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "element_score",
      entityId: saved.scoreId,
    });
    expect(event).toMatchObject({ action: "create" });
    const [evidenceEvent] = await listAuditEvents(tenant.ctx, {
      entity: "score_evidence",
      entityId: saved.evidenceId!,
    });
    // The note itself stays out of the audit trail.
    expect(evidenceEvent?.after).toEqual({
      elementScoreId: saved.scoreId,
      kind: "observation",
      url: null,
      documentVersionId: null,
    });
  });

  it("keeps the only evidence of a Met score", async () => {
    const sheet = (await getAssessmentSheet(nursingHead, id))!;
    const evidenceId = elementsOf(sheet).find((e) => e.id === element.get("2"))!.score!.evidence[0]!
      .id;
    expect(await codeOf(removeEvidence(nursingHead, evidenceId))).toBe("evidenceRequired");
    // With a second piece, one can go.
    const second = await saveElementScore(nursingHead, id, element.get("2")!, {
      levelCode: "MET",
      evidence: { kind: "document", url: "https://dms.example.test/policy/7" },
    });
    await removeEvidence(nursingHead, second.evidenceId!);
    expect(await codeOf(removeEvidence(staff, evidenceId))).toBe("forbidden");
  });

  it("cannot be submitted with elements left to score", async () => {
    expect(await codeOf(submitAssessment(nursingHead, id))).toBe("incomplete");
  });

  it("submits: locks, updates readiness and raises findings", async () => {
    const before = (await getReadiness(qm, tenant.facility.id))[0]!;
    expect(before).toMatchObject({ status: "not_ready", scored: 0 });

    await saveElementScore(nursingHead, id, element.get("3")!, {
      levelCode: "NM",
      comment: "No checklist in the unit.",
    });
    expect(await submitAssessment(nursingHead, id)).toEqual({
      findings: 1,
      statusesUpdated: 2,
      verified: 0,
    });

    const sheet = (await getAssessmentSheet(nursingHead, id))!;
    expect(sheet.assessment.status).toBe("submitted");
    expect(sheet.canScore).toBe(false);
    expect(sheet.findings).toMatchObject([
      { severity: "high", levelCode: "NM", statement: "No checklist in the unit.", status: "open" },
    ]);

    const after = (await getReadiness(qm, tenant.facility.id))[0]!;
    // Two of four applicable elements now have a current score; ESR element 1 is still
    // unverified, so the facility is not ready whatever the score.
    expect(after).toMatchObject({ status: "not_ready", counted: 4, scored: 2, esrUnverified: 1 });
    expect(after.reasons).toContain("esrUnverified");
    expect(after.score).toBeCloseTo(0.25);

    const [event] = await listAuditEvents(tenant.ctx, { entity: "assessment", entityId: id });
    expect(event).toMatchObject({ action: "submit" });
  });

  it("refuses any change once submitted, in the service and in the database", async () => {
    expect(
      await codeOf(
        saveElementScore(nursingHead, id, element.get("3")!, { levelCode: "NM", comment: "x" }),
      ),
    ).toBe("assessmentSubmitted");
    expect(await codeOf(submitAssessment(nursingHead, id))).toBe("assessmentSubmitted");
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`UPDATE element_score SET comment = 'edited' WHERE assessment_id = ${id}::uuid`,
      ),
    ).rejects.toThrow(/submitted and cannot change/);
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`DELETE FROM score_evidence WHERE element_score_id IN (SELECT id FROM element_score WHERE assessment_id = ${id}::uuid)`,
      ),
    ).rejects.toThrow(/submitted and cannot change/);
    await expect(
      withTenant(
        qm,
        (tx) =>
          tx.$executeRaw`UPDATE assessment SET status = 'in_progress', submitted_at = NULL WHERE id = ${id}::uuid`,
      ),
    ).rejects.toThrow(/submitted and cannot change/);
  });
});

describe("findings and element status across assessments", () => {
  it("raises an ESR finding and keeps the newer score when an old draft is submitted late", async () => {
    const early = await startAssessment(qm, tenant.facility.id, { frameworkId });
    const late = await startAssessment(qm, tenant.facility.id, { frameworkId });
    // After the department assessment above, which was stamped with the real clock.
    const day = 24 * 60 * 60 * 1000;
    const at = (days: number) => new Date(Date.now() + days * day);
    const t1 = at(1);
    const t2 = at(2);
    const observation = { kind: "observation", note: "Seen in place." } as const;
    for (const n of ["1", "2", "3", "4"]) {
      await saveElementScore(qm, early, element.get(n)!, { levelCode: "NM", comment: "Gap." }, t1);
      await saveElementScore(
        qm,
        late,
        element.get(n)!,
        { levelCode: "MET", evidence: observation },
        t2,
      );
    }
    await submitAssessment(qm, late, t2);
    const result = await submitAssessment(qm, early, at(3));
    // The early draft's scores are older than the current status: nothing rolls back.
    expect(result).toEqual({ findings: 4, statusesUpdated: 0, verified: 0 });

    const findings = await listFindings(qm, tenant.facility.id, { assessmentId: early });
    expect(findings.map((f) => [f.element.code, f.severity]).sort()).toEqual([
      ["DEMO-X.1.1", "esr"],
      ["DEMO-X.1.2", "esr"],
      ["DEMO-X.1.3", "high"],
      ["DEMO-X.1.4", "high"],
    ]);
    const readiness = (await getReadiness(qm, tenant.facility.id, at(4)))[0]!;
    expect(readiness).toMatchObject({ status: "ready", score: 1, scored: 4 });
    // Ninety days on, every internal score has expired and nothing counts as verified.
    const expired = (await getReadiness(qm, tenant.facility.id, at(100)))[0]!;
    expect(expired).toMatchObject({ status: "not_ready", scored: 0, expired: 4 });
  });

  it("shows a department head only their department's findings", async () => {
    const own = await listFindings(nursingHead, tenant.facility.id);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((f) => f.departmentId === nursingId)).toBe(true);
    expect((await listFindings(qm, tenant.facility.id)).length).toBeGreaterThan(own.length);
    expect(await getReadiness(nursingHead, tenant.facility.id)).toEqual([]);
  });
});
