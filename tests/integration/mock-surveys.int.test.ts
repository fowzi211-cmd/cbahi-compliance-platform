import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { disconnectDb, withSystem } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { memoryObjects } from "@/lib/storage";
import {
  getAssessmentSheet,
  saveElementScore,
  submitAssessment,
} from "@/modules/assessments/service";
import { listAuditEvents } from "@/modules/audit/service";
import {
  PhiDetectedError,
  getDownloadUrl,
  listCitableVersions,
  listDocuments,
} from "@/modules/documents/service";
import { listFindings } from "@/modules/findings/service";
import { setFacilityFrameworks } from "@/modules/standards/service";
import {
  assignConsultant,
  setConsultant,
  updateSubscription,
  type PlatformActor,
} from "@/modules/subscriptions/service";
import {
  exportMockSurveyReport,
  getMockSurvey,
  getMockSurveyOptions,
  listMockSurveys,
  startMockSurvey,
} from "@/modules/surveys/service";
import { addMembership, loadAccessContext, type AccessContext } from "@/modules/tenancy/service";
import { createUser, makeTenant, publishDemoEdition, uniqueEmail } from "./helpers";

// M15: mock surveys run by the quality team (internal) or an assigned consultant, locked,
// and reported as Arabic and English PDFs filed as facility documents. PDFs come from the
// fake renderer here (PDF_RENDERER=fake); the e2e suite prints real ones.
const DAY = 86_400_000;
const start = new Date();
const dayOf = (days: number) => toRiyadhDay(new Date(start.getTime() + days * DAY));

let admin: PlatformActor;
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let frameworkId: string;
let qm: AccessContext;
let viewer: AccessContext;
let consultant: AccessContext;

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof DomainError
        ? error.code
        : error instanceof ForbiddenError
          ? "forbidden"
          : error instanceof PhiDetectedError
            ? "phiDetected"
            : String(error),
  );

async function member(role: "quality_manager" | "viewer") {
  const user = await createUser(uniqueEmail(role), `Demo ${role}`);
  await addMembership(tenant.ctx, { userId: user.id, facilityId: tenant.facility.id, role });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

/** Scores every element: the ESR one Not Met, the rest Met, each with an observation. */
async function scoreAll(ctx: AccessContext, assessmentId: string, statement = "Seen on site.") {
  const sheet = (await getAssessmentSheet(ctx, assessmentId))!;
  for (const element of sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements))) {
    await saveElementScore(ctx, assessmentId, element.id, {
      levelCode: element.isEsr ? "NM" : "MET",
      comment: element.isEsr ? statement : "In place.",
      evidence: { kind: "observation", note: "Walked the clinic." },
    });
  }
}

const statuses = (source: "internal" | "consultant") =>
  withSystem((tx) => tx.elementStatus.count({ where: { facilityId: tenant.facility.id, source } }));

beforeAll(async () => {
  const adminUser = await createUser(uniqueEmail("platform-admin"));
  admin = { userId: adminUser.id, isPlatformAdmin: true };
  tenant = await makeTenant("Mock surveys");
  ({ frameworkId } = await publishDemoEdition({ elements: ["1", "2", "3"], esr: ["1"] }));
  await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [frameworkId]);
  qm = await member("quality_manager");
  viewer = await member("viewer");

  await updateSubscription(admin, tenant.tenant.id, {
    tier: "hybrid",
    startsOn: dayOf(-30),
    endsOn: dayOf(335),
  });
  const email = uniqueEmail("consultant");
  const user = await createUser(email, "Demo consultant");
  await setConsultant(admin, email, true);
  await assignConsultant(admin, tenant.tenant.id, tenant.facility.id, user.id);
  consultant = (await loadAccessContext(user.id, tenant.tenant.id))!;
});

afterAll(disconnectDb);

describe("starting a mock survey", () => {
  it("runs as internal for the quality team and as consultant for an assigned consultant", async () => {
    expect(await getMockSurveyOptions(qm, tenant.facility.id)).toMatchObject({
      source: "internal",
      featureOff: false,
      frameworks: [{ id: frameworkId }],
    });
    expect(await getMockSurveyOptions(consultant, tenant.facility.id)).toMatchObject({
      source: "consultant",
      featureOff: false,
    });
    // §6: the owner and viewers watch mock surveys; they do not run them.
    expect(await getMockSurveyOptions(tenant.ctx, tenant.facility.id)).toBeNull();
    expect(await getMockSurveyOptions(viewer, tenant.facility.id)).toBeNull();
    expect(await codeOf(startMockSurvey(tenant.ctx, tenant.facility.id, { frameworkId }))).toBe(
      "forbidden",
    );
    expect(
      await codeOf(startMockSurvey(qm, tenant.facility.id, { frameworkId: crypto.randomUUID() })),
    ).toBe("unknownFramework");
  });

  it("refuses a consultant survey when the plan turns the feature off", async () => {
    await updateSubscription(admin, tenant.tenant.id, {
      tier: "hybrid",
      startsOn: dayOf(-30),
      endsOn: dayOf(335),
      overrides: { consultantMockSurvey: "off" },
    });
    try {
      expect(await getMockSurveyOptions(consultant, tenant.facility.id)).toMatchObject({
        featureOff: true,
      });
      expect(await codeOf(startMockSurvey(consultant, tenant.facility.id, { frameworkId }))).toBe(
        "featureOff",
      );
    } finally {
      await updateSubscription(admin, tenant.tenant.id, {
        tier: "hybrid",
        startsOn: dayOf(-30),
        endsOn: dayOf(335),
      });
    }
  });
});

describe("an internal mock survey", () => {
  let id: string;

  it("raises findings on lock without moving the internal series or verifying anything", async () => {
    id = await startMockSurvey(qm, tenant.facility.id, { frameworkId });
    expect((await listMockSurveys(qm, tenant.facility.id)).map((a) => a.id)).toContain(id);
    expect(await codeOf(exportMockSurveyReport(qm, id, { phiAttested: true }))).toBe("notLocked");
    await scoreAll(qm, id);
    const result = await submitAssessment(qm, id);
    expect(result).toEqual({ findings: 1, statusesUpdated: 0, verified: 0 });
    expect(await statuses("internal")).toBe(0);
    const findings = await listFindings(qm, tenant.facility.id);
    expect(findings.filter((f) => f.assessmentId === id)).toHaveLength(1);
  });

  it("issues the report once, in both languages, as approved facility documents", async () => {
    const view = (await getMockSurvey(viewer, id))!;
    expect(view).toMatchObject({
      canExport: false,
      reports: [],
      surveyorName: "Demo quality_manager",
    });
    expect(await codeOf(exportMockSurveyReport(viewer, id, { phiAttested: true }))).toBe(
      "forbidden",
    );
    expect(await codeOf(exportMockSurveyReport(qm, id, { phiAttested: false }))).toBe(
      "phiAttestationRequired",
    );
    expect((await getMockSurvey(qm, id))!.canExport).toBe(true);

    const reports = await exportMockSurveyReport(qm, id, { phiAttested: true });
    expect(reports.map((r) => r.locale).sort()).toEqual(["ar", "en"]);
    expect(reports.every((r) => r.fileName.endsWith(`-${r.locale}.pdf`))).toBe(true);
    expect(await codeOf(exportMockSurveyReport(qm, id, { phiAttested: true }))).toBe(
      "alreadyExported",
    );
    expect((await getMockSurvey(qm, id))!.canExport).toBe(false);

    // Filed as approved, facility-wide reports that every member can read and download.
    const documents = await listDocuments(viewer, tenant.facility.id);
    const filed = documents.filter((d) => reports.some((r) => r.documentId === d.id));
    expect(filed).toHaveLength(2);
    expect(filed.every((d) => d.type === "report" && d.departmentId === null)).toBe(true);
    const en = reports.find((r) => r.locale === "en")!;
    expect(await getDownloadUrl(viewer, en.versionId)).toBeTruthy();
    const stored = await withSystem((tx) =>
      tx.documentVersion.findUniqueOrThrow({ where: { id: en.versionId } }),
    );
    expect(stored.status).toBe("approved");
    const { text } = await extractText(memoryObjects.get(stored.storageKey)!.bytes.slice(), {
      mergePages: true,
    });
    expect(text).toContain("DEMO-X.1.1");

    // A report is never evidence for an element.
    const citable = await listCitableVersions(qm, tenant.facility.id);
    expect(citable.some((v) => reports.some((r) => r.versionId === v.versionId))).toBe(false);

    const events = await listAuditEvents(tenant.ctx, { entity: "assessment", entityId: id });
    const event = events.find((e) => e.action === "export");
    expect(event?.after).toMatchObject({ report: "mock_survey", locales: ["ar", "en"] });
  });
});

describe("a consultant mock survey", () => {
  it("feeds the consultant series, never the internal one", async () => {
    const id = await startMockSurvey(consultant, tenant.facility.id, { frameworkId });
    await scoreAll(consultant, id);
    const result = await submitAssessment(consultant, id);
    expect(result).toMatchObject({ findings: 1, statusesUpdated: 3, verified: 0 });
    expect(await statuses("consultant")).toBe(3);
    expect(await statuses("internal")).toBe(0);
    const reports = await exportMockSurveyReport(consultant, id, { phiAttested: true });
    expect(reports).toHaveLength(2);
    expect((await getMockSurvey(consultant, id))!.surveyorName).toBe("Demo consultant");
  });

  it("stops a report that would carry patient data unless the surveyor confirms it", async () => {
    const id = await startMockSurvey(consultant, tenant.facility.id, { frameworkId });
    await scoreAll(consultant, id, "Chart MRN: 556677 left on the desk.");
    await submitAssessment(consultant, id);
    expect(await codeOf(exportMockSurveyReport(consultant, id, { phiAttested: true }))).toBe(
      "phiDetected",
    );
    expect((await getMockSurvey(consultant, id))!.reports).toEqual([]);
    const reports = await exportMockSurveyReport(consultant, id, {
      phiAttested: true,
      phiConfirmed: true,
    });
    expect(reports).toHaveLength(2);
  });
});

describe("the survey_report table", () => {
  it("refuses a report for an assessment that is not a locked mock survey", async () => {
    const id = await startMockSurvey(qm, tenant.facility.id, { frameworkId });
    const [doc] = await withSystem((tx) =>
      tx.document.findMany({
        where: { tenantId: tenant.tenant.id, type: "report" },
        take: 1,
      }),
    );
    await expect(
      withSystem((tx) =>
        tx.surveyReport.create({
          data: {
            tenantId: tenant.tenant.id,
            assessmentId: id,
            locale: "ar",
            documentId: doc!.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps issued reports append-only", async () => {
    const [row] = await withSystem((tx) =>
      tx.surveyReport.findMany({ where: { tenantId: tenant.tenant.id }, take: 1 }),
    );
    await expect(
      withSystem((tx) => tx.surveyReport.delete({ where: { id: row!.id } })),
    ).rejects.toThrow();
  });
});
