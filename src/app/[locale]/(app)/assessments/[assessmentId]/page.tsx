import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { formatPercent } from "@/lib/numbers";
import { requireAppContext } from "@/lib/session";
import { getAssessmentSheet } from "@/modules/assessments/service";
import { AssessmentStatusBadge } from "@/modules/assessments/ui/AssessmentStatusBadge";
import {
  AssessmentFindings,
  AssessmentSheetView,
} from "@/modules/assessments/ui/AssessmentSheetView";
import { SubmitAssessmentForm } from "@/modules/assessments/ui/SubmitAssessmentForm";
import { localized } from "@/modules/standards/service";
import { removeEvidenceAction, saveScoreAction, submitAssessmentAction } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/assessments/[assessmentId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("assessments") };
}

export default async function AssessmentPage({
  params,
}: PageProps<"/[locale]/assessments/[assessmentId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("assessments");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/assessments" className="text-primary text-sm hover:underline">
        {t("sheet.back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <AssessmentBody locale={locale as Locale} params={params} />
      </Suspense>
    </div>
  );
}

async function AssessmentBody({
  locale,
  params,
}: {
  locale: Locale;
  params: Promise<{ assessmentId: string }>;
}) {
  const t = await getTranslations({ locale, namespace: "assessments" });
  const ctx = await requireAppContext(locale);
  const { assessmentId } = await params;
  const sheet = await getAssessmentSheet(ctx.access, assessmentId);
  // Assessments are opened from the active facility; another facility's needs switching first.
  if (!sheet || sheet.assessment.facilityId !== ctx.facilityId) notFound();
  const { assessment, framework, progress } = sheet;
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const scope = assessment.department
    ? name(assessment.department.nameAr, assessment.department.nameEn)
    : t("list.wholeFacility");
  const remaining = progress.total - progress.scored;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("sheet.title", { scope })}</h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <AssessmentStatusBadge status={assessment.status} />
          <span>{name(framework.nameAr, framework.nameEn) || framework.code}</span>
          <span>
            {assessment.submittedAt
              ? t("list.submittedOn", {
                  date: formatDate(assessment.submittedAt, locale, { style: "medium" }),
                })
              : t("list.startedOn", {
                  date: formatDate(assessment.startedAt, locale, { style: "medium" }),
                })}
          </span>
        </p>
      </div>

      <Card className="flex flex-col gap-2">
        <p role="status" data-testid="assessment-progress">
          {t("sheet.progress", { scored: progress.scored, total: progress.total })}
        </p>
        <p className="text-muted-foreground text-sm" data-testid="assessment-score">
          {sheet.score.score === null
            ? t("sheet.noScore")
            : t("sheet.score", { percent: formatPercent(sheet.score.score) })}
        </p>
      </Card>

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
        saveAction={saveScoreAction}
        removeEvidenceAction={removeEvidenceAction}
      />

      {sheet.canScore && (
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("submit.title")}</CardTitle>
          <SubmitAssessmentForm
            assessmentId={assessment.id}
            remaining={remaining}
            action={submitAssessmentAction}
          />
        </Card>
      )}
    </>
  );
}
