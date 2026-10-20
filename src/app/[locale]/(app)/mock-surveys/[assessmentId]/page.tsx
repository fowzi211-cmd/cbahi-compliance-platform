import { Download } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPercent } from "@/lib/numbers";
import { requireAppContext } from "@/lib/session";
import { AssessmentStatusBadge } from "@/modules/assessments/ui/AssessmentStatusBadge";
import {
  AssessmentFindings,
  AssessmentSheetView,
} from "@/modules/assessments/ui/AssessmentSheetView";
import { SubmitAssessmentForm } from "@/modules/assessments/ui/SubmitAssessmentForm";
import { listCitableVersions } from "@/modules/documents/service";
import { localized } from "@/modules/standards/service";
import { getMockSurvey } from "@/modules/surveys/service";
import { ExportReportForm } from "@/modules/surveys/ui/ExportReportForm";
import {
  removeEvidenceAction,
  saveScoreAction,
  submitAssessmentAction,
} from "../../assessments/actions";
import { exportReportAction } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/mock-surveys/[assessmentId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("mockSurveys") };
}

export default async function MockSurveyPage({
  params,
}: PageProps<"/[locale]/mock-surveys/[assessmentId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("mockSurveys.sheet");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/mock-surveys" className="text-primary text-sm hover:underline">
        {t("back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <MockSurveyBody locale={locale as Locale} params={params} />
      </Suspense>
    </div>
  );
}

async function MockSurveyBody({
  locale,
  params,
}: {
  locale: Locale;
  params: Promise<{ assessmentId: string }>;
}) {
  const t = await getTranslations({ locale, namespace: "mockSurveys" });
  const tAssessments = await getTranslations({ locale, namespace: "assessments" });
  const ctx = await requireAppContext(locale);
  const { assessmentId } = await params;
  const view = await getMockSurvey(ctx.access, assessmentId);
  if (!view || view.sheet.assessment.facilityId !== ctx.facilityId) notFound();
  const { sheet } = view;
  const { assessment, framework, progress } = sheet;
  const frameworkName =
    localized(locale, framework.nameAr, framework.nameEn).text || framework.code;
  const documents = sheet.canScore ? await listCitableVersions(ctx.access, ctx.facilityId) : [];
  const download = (versionId: string) =>
    getPathname({ href: `/documents/versions/${versionId}/download`, locale });

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">
          {t("sheet.title", { framework: frameworkName })}
        </h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={assessment.source === "consultant" ? "success" : "default"}>
            {t(`kinds.${assessment.source}`)}
          </Badge>
          <AssessmentStatusBadge status={assessment.status} />
          {view.surveyorName && <span>{t("sheet.surveyor", { name: view.surveyorName })}</span>}
          <span>
            {assessment.submittedAt
              ? t("submittedOn", {
                  date: formatDate(assessment.submittedAt, locale, { style: "medium" }),
                })
              : t("startedOn", {
                  date: formatDate(assessment.startedAt, locale, { style: "medium" }),
                })}
          </span>
        </p>
        <p className="text-muted-foreground text-sm">
          {assessment.source === "consultant"
            ? t("sheet.seriesConsultant")
            : t("sheet.seriesInternal")}
        </p>
      </div>

      <Card className="flex flex-col gap-2">
        <p role="status" data-testid="assessment-progress">
          {tAssessments("sheet.progress", { scored: progress.scored, total: progress.total })}
        </p>
        <p className="text-muted-foreground text-sm" data-testid="assessment-score">
          {sheet.score.score === null
            ? tAssessments("sheet.noScore")
            : tAssessments("sheet.score", { percent: formatPercent(sheet.score.score) })}
        </p>
      </Card>

      {assessment.status === "submitted" && (
        <Card className="flex flex-col gap-3" data-testid="mock-survey-report">
          <CardTitle>{t("export.title")}</CardTitle>
          {view.reports.length > 0 ? (
            <>
              <CardDescription>
                {t("export.issued", { date: formatDateTime(view.reports[0]!.createdAt, locale) })}
              </CardDescription>
              <ul className="flex flex-col gap-2">
                {view.reports.map((r) => (
                  <li key={r.locale}>
                    <a
                      href={download(r.versionId)}
                      className="text-primary inline-flex items-center gap-2 hover:underline"
                      data-report={r.locale}
                    >
                      <Download className="size-4" aria-hidden />
                      {t(`export.download.${r.locale}`)}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : view.canExport ? (
            <>
              <CardDescription>{t("export.hint")}</CardDescription>
              <ExportReportForm assessmentId={assessment.id} action={exportReportAction} />
            </>
          ) : (
            <CardDescription>{t("export.notYet")}</CardDescription>
          )}
        </Card>
      )}

      {assessment.status === "submitted" ? (
        <>
          <Alert tone="info">{t("sheet.lockedNote")}</Alert>
          <AssessmentFindings locale={locale} sheet={sheet} />
        </>
      ) : !sheet.canScore ? (
        <Alert tone="info">{t("sheet.readOnly")}</Alert>
      ) : null}

      <AssessmentSheetView
        locale={locale}
        sheet={sheet}
        documents={documents}
        saveAction={saveScoreAction}
        removeEvidenceAction={removeEvidenceAction}
      />

      {sheet.canScore && (
        <Card className="flex flex-col gap-3">
          <CardTitle>{tAssessments("submit.title")}</CardTitle>
          <SubmitAssessmentForm
            assessmentId={assessment.id}
            remaining={progress.total - progress.scored}
            action={submitAssessmentAction}
          />
        </Card>
      )}
    </>
  );
}
