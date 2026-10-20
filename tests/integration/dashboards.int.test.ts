import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import {
  getAssessmentSheet,
  saveElementScore,
  startAssessment,
  submitAssessment,
} from "@/modules/assessments/service";
import { runSnapshots } from "@/modules/dashboards/jobs";
import { getDashboard, getTrend } from "@/modules/dashboards/service";
import { createDocument, decideVersion } from "@/modules/documents/service";
import { makePdf } from "@/modules/documents/test-files";
import { setFacilityFrameworks } from "@/modules/standards/service";
import { saveSurveyCycle } from "@/modules/surveys/service";
import {
  addMembership,
  createDepartment,
  loadAccessContext,
  type AccessContext,
} from "@/modules/tenancy/service";
import { createUser, makeTenant, publishDemoEdition, uniqueEmail } from "./helpers";

// M13: the nightly snapshot and the readiness overview. Elements 1 (ESR) and 2 belong to
// nursing, 3 to the pharmacy, 4 to no department.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let facilityId: string;
let frameworkId: string;
let nursingId: string;
let pharmacyId: string;
let elements: { id: string; code: string }[];
let head: AccessContext;
let viewer: AccessContext;

const DAY = 86_400_000;
const start = new Date();
const at = (days: number) => new Date(start.getTime() + days * DAY);
const dayOf = (days: number) => toRiyadhDay(at(days));

async function member(
  role: "department_head" | "viewer",
  departmentId?: string,
): Promise<AccessContext> {
  const user = await createUser(uniqueEmail(role));
  await addMembership(tenant.ctx, {
    userId: user.id,
    facilityId,
    role,
    ...(departmentId ? { departmentId } : {}),
  });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

/** An assessment (whole facility, or one department) with the given level per element. */
async function assess(levels: Record<string, string>, evidence?: string, departmentId?: string) {
  const assessmentId = await startAssessment(tenant.ctx, facilityId, {
    frameworkId,
    ...(departmentId ? { departmentId } : {}),
  });
  for (const [n, levelCode] of Object.entries(levels)) {
    const element = elements.find((e) => e.code.endsWith(`.${n}`))!;
    await saveElementScore(tenant.ctx, assessmentId, element.id, {
      levelCode,
      comment: "Checked.",
      evidence: evidence
        ? { kind: "document", documentVersionId: evidence }
        : { kind: "observation", note: "Seen on site." },
    });
  }
  await submitAssessment(tenant.ctx, assessmentId);
}

beforeAll(async () => {
  tenant = await makeTenant("Dashboards");
  facilityId = tenant.facility.id;
  ({ frameworkId } = await publishDemoEdition({
    elements: ["1", "2", "3", "4"],
    esr: ["1"],
    departmentTypes: { "1": "nursing", "2": "nursing", "3": "pharmacy" },
  }));
  await setFacilityFrameworks(tenant.ctx, facilityId, [frameworkId]);
  for (const [name, typeCode] of [
    ["Nursing", "nursing"],
    ["Pharmacy", "pharmacy"],
  ] as const) {
    const { id } = await createDepartment(tenant.ctx, {
      facilityId,
      nameAr: name,
      nameEn: name,
      typeCode,
    });
    if (typeCode === "nursing") nursingId = id;
    else pharmacyId = id;
  }
  const assessmentId = await startAssessment(tenant.ctx, facilityId, { frameworkId });
  elements = (await getAssessmentSheet(tenant.ctx, assessmentId))!.chapters.flatMap((c) =>
    c.standards.flatMap((s) => s.elements.map((e) => ({ id: e.id, code: e.code }))),
  );
  head = await member("department_head", nursingId);
  viewer = await member("viewer");
});

afterAll(disconnectDb);

describe("readiness overview", () => {
  it("starts with every element unverified and the ESR element blocking readiness", async () => {
    const dashboard = (await getDashboard(viewer, facilityId))!;
    expect(dashboard.scope).toBe("facility");
    const overview = dashboard.frameworks[0]!.overview!;
    expect(overview.status).toBe("not_ready");
    expect(overview.esr).toEqual([
      expect.objectContaining({
        state: "unverified",
        element: expect.objectContaining({ isEsr: true }),
      }),
    ]);
    expect(overview.unverifiedTotal).toBe(4);
    // ESR elements are named first.
    expect(overview.unverified[0]!.isEsr).toBe(true);
    expect(dashboard.facilityWide!.survey).toMatchObject({ state: "unknown", days: null });
  });

  it("breaks scores down by chapter and department, and limits a department head to theirs", async () => {
    await assess({ "1": "MET", "2": "PM", "3": "NM", "4": "MET" });
    const overview = (await getDashboard(viewer, facilityId))!.frameworks[0]!.overview!;
    expect(overview.status).toBe("at_risk");
    expect(overview.facility).toMatchObject({ scored: 4, counted: 4 });
    expect(overview.facility.score).toBeCloseTo(0.625);
    expect(overview.chapters).toHaveLength(1);
    expect(overview.esr[0]!.state).toBe("met");
    expect(overview.unverifiedTotal).toBe(0);
    const departments = (await getDashboard(viewer, facilityId))!.frameworks[0]!.departments;
    expect(departments.map((d) => [d.department.nameEn, d.score])).toEqual([
      ["Nursing", 0.75],
      ["Pharmacy", 0],
    ]);

    const own = (await getDashboard(head, facilityId))!;
    expect(own.scope).toBe("departments");
    expect(own.facilityWide).toBeNull();
    expect(own.frameworks[0]!.overview).toBeNull();
    expect(own.frameworks[0]!.departments.map((d) => d.departmentId)).toEqual([nursingId]);
    expect(await getTrend(head, facilityId)).toEqual([]);
  });

  it("counts down to the expected survey", async () => {
    await saveSurveyCycle(tenant.ctx, facilityId, {
      status: "accredited",
      lastSurveyOn: "2024-01-10",
      nextExpectedOn: dayOf(45),
    });
    expect((await getDashboard(viewer, facilityId))!.facilityWide!.survey).toMatchObject({
      nextExpectedOn: dayOf(45),
      state: "soon",
      days: 45,
    });
  });

  it("names documents about to expire, and elements whose cited document has expired", async () => {
    const { versionId } = await createDocument(tenant.ctx, facilityId, {
      type: "policy",
      titleEn: "Demo pharmacy policy",
      file: { name: "p.pdf", bytes: makePdf(["Demo pharmacy policy", crypto.randomUUID()]) },
      effectiveOn: dayOf(-30),
      expiresOn: dayOf(10),
      phiAttested: true,
    });
    await decideVersion(tenant.ctx, versionId, { decision: "approved" });
    await assess({ "3": "MET" }, versionId, pharmacyId);

    const now = (await getDashboard(viewer, facilityId))!.facilityWide!;
    expect(now.documents.expiring.map((d) => d.versionId)).toEqual([versionId]);
    expect(now.expiredEvidence).toEqual([]);

    const later = (await getDashboard(viewer, facilityId, at(12)))!.facilityWide!;
    expect(later.documents.expiring).toEqual([]);
    expect(later.documents.expired.map((d) => d.versionId)).toEqual([versionId]);
    expect(later.expiredEvidence.map((e) => [e.element.code, e.document.versionId])).toEqual([
      [elements.find((e) => e.code.endsWith(".3"))!.code, versionId],
    ]);
  });
});

describe("nightly snapshot", () => {
  it("records each day once and never rewrites it", async () => {
    expect(await runSnapshots(tenant.tenant.id, at(1))).toBe(1);
    expect(await runSnapshots(tenant.tenant.id, at(1))).toBe(0);

    // A day later scores move; the earlier day keeps what it recorded.
    await assess({ "3": "PM" }, undefined, pharmacyId);
    expect(await runSnapshots(tenant.tenant.id, at(2))).toBe(1);
    const [trend] = await getTrend(viewer, facilityId, at(2));
    expect(trend!.frameworkId).toBe(frameworkId);
    expect(trend!.points.map((p) => p.day)).toEqual([dayOf(1), dayOf(2)]);
    expect(trend!.points[0]!.internal).toBeCloseTo(0.875);
    expect(trend!.points[1]!.internal).toBeCloseTo(0.75);
    expect(trend!.points.every((p) => p.consultant === null)).toBe(true);
  });

  it("stores the breakdown and refuses any change to a recorded day", async () => {
    const row = await withTenant(tenant.ctx, (tx) =>
      tx.complianceSnapshot.findFirstOrThrow({ where: { facilityId }, orderBy: { day: "asc" } }),
    );
    expect(row).toMatchObject({ series: "internal", status: "ready", counted: 4, scored: 4 });
    expect(row.departments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: pharmacyId, score: 1, counted: 1 }),
      ]),
    );
    await expect(
      withTenant(tenant.ctx, (tx) =>
        tx.complianceSnapshot.updateMany({ where: { facilityId }, data: { score: 1 } }),
      ),
    ).rejects.toThrow(/cannot change/);
  });

  it("shows only the window of the last 180 days", async () => {
    expect(await getTrend(viewer, facilityId, at(400))).toEqual([]);
  });
});
