import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { AssessmentStatusBadge } from "@/modules/assessments/ui/AssessmentStatusBadge";
import { localized } from "@/modules/standards/service";
import { getMockSurveyOptions, listMockSurveys } from "@/modules/surveys/service";
import { StartMockSurveyForm } from "@/modules/surveys/ui/StartMockSurveyForm";
import { startMockSurveyAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/mock-surveys">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("mockSurveys") };
}

export default async function MockSurveysPage({ params }: PageProps<"/[locale]/mock-surveys">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("mockSurveys");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <MockSurveysBody locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function MockSurveysBody({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "mockSurveys" });
  const ctx = await requireAppContext(locale);
  const [options, surveys] = await Promise.all([
    getMockSurveyOptions(ctx.access, ctx.facilityId),
    listMockSurveys(ctx.access, ctx.facilityId),
  ]);
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;

  return (
    <>
      {options && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("startTitle")}</CardTitle>
          {options.featureOff ? (
            <CardDescription>{t("featureOff")}</CardDescription>
          ) : options.frameworks.length === 0 ? (
            <CardDescription>{t("noFrameworks")}</CardDescription>
          ) : (
            <>
              <CardDescription>
                {options.source === "consultant" ? t("asConsultant") : t("asInternal")}
              </CardDescription>
              <StartMockSurveyForm
                frameworks={options.frameworks.map((f) => ({
                  value: f.id,
                  label: `${name(f.nameAr, f.nameEn) || f.code} (${f.edition})`,
                }))}
                action={startMockSurveyAction}
              />
            </>
          )}
        </Card>
      )}

      <section aria-labelledby="mock-surveys-heading" className="flex flex-col gap-3">
        <h2 id="mock-surveys-heading" className="text-lg font-semibold">
          {t("heading")}
        </h2>
        {surveys.length === 0 ? (
          <Card>
            <CardDescription>{t("empty")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="mock-survey-list">
              {surveys.map((s) => (
                <li
                  key={s.id}
                  data-assessment={s.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">
                      {name(s.framework.nameAr, s.framework.nameEn) || s.framework.code}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={s.source === "consultant" ? "success" : "default"}>
                        {t(`kinds.${s.source}`)}
                      </Badge>
                      <AssessmentStatusBadge status={s.status} />
                      <span>{t("scored", { count: s.scoredCount })}</span>
                      <span>
                        {s.submittedAt
                          ? t("submittedOn", {
                              date: formatDate(s.submittedAt, locale, { style: "medium" }),
                            })
                          : t("startedOn", {
                              date: formatDate(s.startedAt, locale, { style: "medium" }),
                            })}
                      </span>
                    </span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/mock-surveys/${s.id}`}>{t("open")}</Link>
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
