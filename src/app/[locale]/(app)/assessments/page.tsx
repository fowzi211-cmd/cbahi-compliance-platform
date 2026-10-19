import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { getStartOptions, listAssessments } from "@/modules/assessments/service";
import { AssessmentStatusBadge } from "@/modules/assessments/ui/AssessmentStatusBadge";
import { StartAssessmentForm } from "@/modules/assessments/ui/StartAssessmentForm";
import { localized } from "@/modules/standards/service";
import { startAssessmentAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/assessments">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("assessments") };
}

export default async function AssessmentsPage({ params }: PageProps<"/[locale]/assessments">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("assessments.list");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <AssessmentsBody locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function AssessmentsBody({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "assessments.list" });
  const ctx = await requireAppContext(locale);
  const [options, assessments] = await Promise.all([
    getStartOptions(ctx.access, ctx.facilityId),
    listAssessments(ctx.access, ctx.facilityId),
  ]);
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const scopes = options
    ? [
        ...(options.wholeFacility ? [{ value: "", label: t("wholeFacility") }] : []),
        ...options.departments.map((d) => ({ value: d.id, label: name(d.nameAr, d.nameEn) })),
      ]
    : [];

  return (
    <>
      {options && scopes.length > 0 && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("startTitle")}</CardTitle>
          {options.frameworks.length === 0 ? (
            <CardDescription>{t("noFrameworks")}</CardDescription>
          ) : (
            <StartAssessmentForm
              frameworks={options.frameworks.map((f) => ({
                value: f.id,
                label: `${name(f.nameAr, f.nameEn) || f.code} (${f.edition})`,
              }))}
              scopes={scopes}
              action={startAssessmentAction}
            />
          )}
        </Card>
      )}

      <section aria-labelledby="assessments-heading" className="flex flex-col gap-3">
        <h2 id="assessments-heading" className="text-lg font-semibold">
          {t("heading")}
        </h2>
        {assessments.length === 0 ? (
          <Card>
            <CardDescription>{t("empty")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="assessment-list">
              {assessments.map((a) => (
                <li
                  key={a.id}
                  data-assessment={a.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">
                      {a.department
                        ? name(a.department.nameAr, a.department.nameEn)
                        : t("wholeFacility")}
                      {" · "}
                      {name(a.framework.nameAr, a.framework.nameEn) || a.framework.code}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                      <AssessmentStatusBadge status={a.status} />
                      <span>{t("scored", { count: a.scoredCount })}</span>
                      <span>
                        {a.submittedAt
                          ? t("submittedOn", {
                              date: formatDate(a.submittedAt, locale, { style: "medium" }),
                            })
                          : t("startedOn", {
                              date: formatDate(a.startedAt, locale, { style: "medium" }),
                            })}
                      </span>
                    </span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/assessments/${a.id}`}>{t("open")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
