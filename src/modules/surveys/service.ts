import { z } from "zod";
import { withTenant, type TenantContext, type Tx } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { pdfFontCss, renderPdfs } from "@/lib/pdf";
import {
  getAssessmentSheet,
  listAssessments,
  readyScore,
  startMockSurveyAssessment,
  type AssessmentSheet,
  type ScoreSource,
} from "@/modules/assessments/service";
import { recordAudit } from "@/modules/audit/service";
import { fileReports } from "@/modules/documents/service";
import { listFacilityFrameworks } from "@/modules/standards/service";
import { isFeatureEnabled } from "@/modules/subscriptions/service";
import { allowed, getFacility, listUserNames, type AccessContext } from "@/modules/tenancy/service";
import { reportFileName, reportLocales, reportSummary, type ReportLocale } from "./domain/report";
import { renderReportHtml } from "./ui/report-html";
import { reportTranslator } from "./ui/report-messages";
import {
  accreditationStatuses,
  surveyCycleProblem,
  type AccreditationStatus,
} from "./domain/survey-cycle";
import * as repo from "./repo";

export { accreditationStatuses, suggestNextSurvey } from "./domain/survey-cycle";
export type { AccreditationStatus, SurveyCycleProblem } from "./domain/survey-cycle";

// Calendar days travel as "YYYY-MM-DD" and are stored in DATE columns, which Prisma maps to
// midnight UTC. Converting at this boundary keeps any time zone from shifting the day.
const toDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const fromDay = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);

export type SurveyCycle = {
  status: AccreditationStatus;
  lastSurveyOn: string | null;
  nextExpectedOn: string | null;
  notes: string | null;
  updatedAt: Date | null;
};

/** The facility's accreditation cycle; a never-surveyed default when none is saved yet. */
export async function getSurveyCycle(
  ctx: AccessContext,
  facilityId: string,
): Promise<SurveyCycle | null> {
  if (!(await getFacility(ctx, facilityId))) return null;
  const row = await withTenant(ctx, (tx) => repo.findSurveyCycle(tx, ctx.tenantId, facilityId));
  if (!row) {
    return {
      status: "never_surveyed",
      lastSurveyOn: null,
      nextExpectedOn: null,
      notes: null,
      updatedAt: null,
    };
  }
  return {
    status: row.status,
    lastSurveyOn: toDay(row.lastSurveyOn),
    nextExpectedOn: toDay(row.nextExpectedOn),
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

/** The expected survey day inside the caller's transaction (jobs); null when none is set. */
export async function nextExpectedSurveyIn(tx: Tx, ctx: TenantContext, facilityId: string) {
  const row = await repo.findSurveyCycle(tx, ctx.tenantId, facilityId);
  return toDay(row?.nextExpectedOn ?? null);
}

const optionalDay = z
  .string()
  .trim()
  .max(10)
  .nullish()
  .transform((value) => value || null);

const surveyCycleInput = z.object({
  status: z.enum(accreditationStatuses),
  lastSurveyOn: optionalDay,
  nextExpectedOn: optionalDay,
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((value) => value || null),
});
export type SurveyCycleInput = z.input<typeof surveyCycleInput>;

/** Saves the facility's accreditation cycle. Dates must tell a consistent story (domain rule). */
export async function saveSurveyCycle(
  ctx: AccessContext,
  facilityId: string,
  input: SurveyCycleInput,
  now = new Date(),
) {
  if (!allowed(ctx, "facility.updateSettings", { facilityId })) {
    throw new ForbiddenError("facility.updateSettings");
  }
  const data = surveyCycleInput.parse(input);
  const problem = surveyCycleProblem(data, toRiyadhDay(now));
  if (problem) throw new DomainError(problem);
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("facility.updateSettings");

  return withTenant(ctx, async (tx) => {
    const before = await repo.findSurveyCycle(tx, ctx.tenantId, facilityId);
    const saved = await repo.upsertSurveyCycle(tx, ctx.tenantId, facilityId, {
      status: data.status,
      lastSurveyOn: fromDay(data.lastSurveyOn),
      nextExpectedOn: fromDay(data.nextExpectedOn),
      notes: data.notes,
      updatedBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: before ? "update" : "create",
      entity: "survey_cycle",
      entityId: saved.id,
      before: before && {
        status: before.status,
        lastSurveyOn: toDay(before.lastSurveyOn),
        nextExpectedOn: toDay(before.nextExpectedOn),
      },
      after: {
        status: data.status,
        lastSurveyOn: data.lastSurveyOn,
        nextExpectedOn: data.nextExpectedOn,
      },
    });
    return saved.id;
  });
}

// --- Mock surveys (M15) -----------------------------------------------------------------------
// A mock survey is a whole-facility assessment scored the way a surveyor would, by the quality
// team (internal) or by an assigned consultant on a Hybrid plan. Locking it raises its
// findings; its printed report is filed as a facility document in Arabic and English.

export type MockSurveyError = "featureOff" | "notMockSurvey" | "notLocked" | "alreadyExported";

/**
 * Who the caller would run a mock survey as in this facility: a consultant runs consultant
 * surveys, the quality team internal ones. Null when they may run neither.
 */
function surveySourceFor(ctx: AccessContext, facilityId: string): ScoreSource | null {
  const as = (source: ScoreSource) =>
    allowed(ctx, "mockSurvey.run", { facilityId, departmentId: null, surveyKind: source });
  return as("consultant") ? "consultant" : as("internal") ? "internal" : null;
}

/** What the caller may start: the source they would survey as and the facility's editions. */
export async function getMockSurveyOptions(
  ctx: AccessContext,
  facilityId: string,
  now = new Date(),
) {
  const source = surveySourceFor(ctx, facilityId);
  if (!source || !(await getFacility(ctx, facilityId))) return null;
  const featureOff =
    source === "consultant" && !(await isFeatureEnabled(ctx, "consultantMockSurvey", now));
  return { source, featureOff, frameworks: await listFacilityFrameworks(ctx, facilityId) };
}

export async function listMockSurveys(ctx: AccessContext, facilityId: string) {
  return listAssessments(ctx, facilityId, "mock_survey");
}

/** Starts a mock survey; a consultant survey needs the tenant's plan to include it (rule 10). */
export async function startMockSurvey(
  ctx: AccessContext,
  facilityId: string,
  input: { frameworkId: string },
  now = new Date(),
) {
  const source = surveySourceFor(ctx, facilityId);
  if (!source) throw new ForbiddenError("mockSurvey.run");
  if (source === "consultant" && !(await isFeatureEnabled(ctx, "consultantMockSurvey", now))) {
    throw new DomainError<MockSurveyError>("featureOff");
  }
  return startMockSurveyAssessment(
    ctx,
    facilityId,
    { frameworkId: input.frameworkId, source },
    now,
  );
}

/**
 * Issuing the report is for whoever runs this kind of survey and for the facility's quality
 * leadership; every member can read and download it once issued.
 */
function canExport(ctx: AccessContext, sheet: AssessmentSheet) {
  const { facilityId, source } = sheet.assessment;
  return (
    allowed(ctx, "mockSurvey.run", { facilityId, departmentId: null, surveyKind: source }) ||
    allowed(ctx, "assessment.score", { facilityId, departmentId: null })
  );
}

async function loadMockSurvey(ctx: AccessContext, assessmentId: string) {
  const sheet = await getAssessmentSheet(ctx, assessmentId);
  return sheet && sheet.assessment.kind === "mock_survey" ? sheet : null;
}

async function reportsOf(ctx: AccessContext, assessmentId: string) {
  const rows = await withTenant(ctx, (tx) => repo.listReports(tx, ctx.tenantId, assessmentId));
  return rows.flatMap((row) => {
    const version = row.document.versions[0];
    return version
      ? [
          {
            locale: row.locale as ReportLocale,
            documentId: row.document.id,
            versionId: version.id,
            fileName: version.fileName,
            bytes: version.bytes,
            createdAt: row.createdAt,
          },
        ]
      : [];
  });
}

/** One mock survey: its sheet, the reports issued for it and what the caller may do. */
export async function getMockSurvey(ctx: AccessContext, assessmentId: string) {
  const sheet = await loadMockSurvey(ctx, assessmentId);
  if (!sheet) return null;
  const reports = sheet.assessment.status === "submitted" ? await reportsOf(ctx, assessmentId) : [];
  const names = await listUserNames(
    ctx,
    [sheet.assessment.startedBy, sheet.assessment.submittedBy].filter(
      (id): id is string => id !== null,
    ),
  );
  return {
    sheet,
    reports,
    surveyorName: names.get(sheet.assessment.startedBy ?? "") ?? null,
    canExport:
      sheet.assessment.status === "submitted" &&
      reports.length < reportLocales.length &&
      canExport(ctx, sheet),
  };
}
export type MockSurveyView = NonNullable<Awaited<ReturnType<typeof getMockSurvey>>>;

/** The report's contents, in both languages, from a locked survey. */
function reportPages(
  view: MockSurveyView,
  facility: { nameAr: string | null; nameEn: string | null },
  fontCss: string,
  now: Date,
) {
  const { sheet } = view;
  const elements = sheet.chapters.flatMap((chapter) =>
    chapter.standards.flatMap((standard) =>
      standard.elements.flatMap((e) =>
        e.score
          ? [
              {
                code: e.code,
                titleAr: e.titleAr,
                titleEn: e.titleEn,
                chapterCode: chapter.code,
                isEsr: e.isEsr,
                levelCode: e.score.levelCode,
                fullyMet: e.score.normalized !== null && e.score.normalized >= 1 - 1e-9,
                notApplicable: e.score.normalized === null,
                comment: e.score.comment,
              },
            ]
          : [],
      ),
    ),
  );
  const summary = reportSummary({
    score: sheet.score.score,
    scale: sheet.scale,
    chapters: sheet.chapters.map((c) => {
      const node = sheet.chapterScores.get(c.id);
      return {
        code: c.code,
        titleAr: c.titleAr,
        titleEn: c.titleEn,
        score: node?.score ?? null,
        counted: node?.counted ?? 0,
      };
    }),
    elements,
    findings: sheet.findings.map((f) => ({
      elementCode: f.element.code,
      titleAr: f.element.titleAr,
      titleEn: f.element.titleEn,
      severity: f.severity,
      levelCode: f.levelCode,
      statement: f.statement,
    })),
    readyScore,
    esrBlocksReadiness: sheet.esrBlocksReadiness,
  });
  const meta = {
    facilityNameAr: facility.nameAr,
    facilityNameEn: facility.nameEn,
    frameworkNameAr: sheet.framework.nameAr,
    frameworkNameEn: sheet.framework.nameEn,
    frameworkCode: sheet.framework.code,
    frameworkEdition: sheet.framework.edition,
    source: sheet.assessment.source,
    surveyorName: view.surveyorName,
    startedAt: sheet.assessment.startedAt,
    submittedAt: sheet.assessment.submittedAt!,
    printedAt: now,
  };
  return reportLocales.map((locale) => ({
    locale,
    ...renderReportHtml({
      locale,
      t: reportTranslator(locale),
      meta,
      summary,
      levels: sheet.scale,
      fontCss,
    }),
  }));
}

const exportInput = z.object({
  phiAttested: z.boolean(),
  phiConfirmed: z.boolean().default(false),
});

/**
 * Prints the findings report of a locked mock survey in Arabic and English and files both as
 * facility documents, linked to the survey. Issued once: the survey cannot change, so a
 * second print would only differ in its date. Audited as an export.
 */
export async function exportMockSurveyReport(
  ctx: AccessContext,
  assessmentId: string,
  input: z.input<typeof exportInput>,
  now = new Date(),
) {
  const attestation = exportInput.parse(input);
  const view = await getMockSurvey(ctx, assessmentId);
  if (!view) throw new DomainError<MockSurveyError>("notMockSurvey");
  const { sheet } = view;
  if (sheet.assessment.status !== "submitted") throw new DomainError<MockSurveyError>("notLocked");
  if (!canExport(ctx, sheet)) throw new ForbiddenError("mockSurvey.run");
  if (view.reports.length > 0) throw new DomainError<MockSurveyError>("alreadyExported");
  const facility = await getFacility(ctx, sheet.assessment.facilityId);
  if (!facility) throw new DomainError<MockSurveyError>("notMockSurvey");

  const pages = reportPages(view, facility, await pdfFontCss(), now);
  const pdfs = await renderPdfs(pages);
  const submittedOn = toRiyadhDay(sheet.assessment.submittedAt!);
  const edition = `${sheet.framework.code} ${sheet.framework.edition}`;
  const files = pages.map((page, i) => {
    const title = (locale: ReportLocale) =>
      reportTranslator(locale)("documentTitle", {
        edition,
        date: submittedOn,
        language: reportTranslator(locale)(`languages.${page.locale}`),
      });
    return {
      titleAr: title("ar"),
      titleEn: title("en"),
      fileName: reportFileName({
        frameworkCode: sheet.framework.code,
        submittedOn,
        locale: page.locale,
      }),
      bytes: pdfs[i]!,
    };
  });

  await fileReports(
    ctx,
    sheet.assessment.facilityId,
    files,
    attestation,
    now,
    async (tx, created) => {
      for (const [i, doc] of created.entries()) {
        await repo.insertReport(tx, ctx.tenantId, {
          assessmentId,
          locale: pages[i]!.locale,
          documentId: doc.documentId,
          createdBy: ctx.userId,
        });
      }
      await recordAudit(tx, ctx, {
        action: "export",
        entity: "assessment",
        entityId: assessmentId,
        after: {
          report: "mock_survey",
          locales: pages.map((p) => p.locale),
          documentIds: created.map((d) => d.documentId),
        },
      });
    },
  );
  return reportsOf(ctx, assessmentId);
}
