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
import { AssessmentStatusBadge } from "@/modules/assessments/ui/AssessmentStatusBadge";
import { localized } from "@/modules/standards/service";
import {
  getTemplateOptions,
  listTracers,
  sampleSizeLimits,
  tracerFrequencies,
  tracerLimits,
  type TracerTemplateView,
} from "@/modules/tracers/service";
import { DueBadge } from "@/modules/tracers/ui/DueBadge";
import { TemplateForm } from "@/modules/tracers/ui/TemplateForm";
import { TracerActionButton } from "@/modules/tracers/ui/TracerActionButton";
import { archiveTemplateAction, createTemplateAction, startRunAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tracers">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("tracers") };
}

export default async function TracersPage({ params }: PageProps<"/[locale]/tracers">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("tracers.list");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <TracersBody locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function TracersBody({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "tracers" });
  const ctx = await requireAppContext(locale);
  const [overview, options] = await Promise.all([
    listTracers(ctx.access, ctx.facilityId),
    getTemplateOptions(ctx.access, ctx.facilityId),
  ]);
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const date = (value: Date | string) =>
    formatDate(typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value, locale, {
      style: "medium",
    });

  return (
    <>
      <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
        <h2 id="templates-heading" className="text-lg font-semibold">
          {t("list.templatesHeading")}
        </h2>
        {overview.templates.length === 0 ? (
          <Card>
            <CardDescription>{t("list.noTemplates")}</CardDescription>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="tracer-templates">
            {overview.templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                locale={locale}
                title={name(template.nameAr, template.nameEn)}
                date={date}
              />
            ))}
          </ul>
        )}
      </section>

      {options && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("list.newTitle")}</CardTitle>
            <CardDescription>{t("list.newIntro")}</CardDescription>
          </div>
          <TemplateForm
            frameworks={options.frameworks.map((f) => ({
              value: f.id,
              label: `${name(f.nameAr, f.nameEn) || f.code} (${f.edition})`,
              chapters: f.chapters.map((c) => ({
                value: c.id,
                label: `${c.code} ${name(c.titleAr, c.titleEn)}`.trim(),
              })),
            }))}
            scopes={[
              ...(options.wholeFacility ? [{ value: "", label: t("list.wholeFacility") }] : []),
              ...options.departments.map((d) => ({ value: d.id, label: name(d.nameAr, d.nameEn) })),
            ]}
            people={options.people.map((p) => ({ value: p.userId, label: p.name }))}
            frequencies={tracerFrequencies.map((f) => ({
              value: f,
              label: t(`list.frequency.${f}`),
            }))}
            limits={{ ...sampleSizeLimits, name: tracerLimits.name }}
            action={createTemplateAction}
          />
        </Card>
      )}

      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <h2 id="runs-heading" className="text-lg font-semibold">
          {t("list.runsHeading")}
        </h2>
        {overview.runs.length === 0 ? (
          <Card>
            <CardDescription>{t("list.noRuns")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="tracer-runs">
              {overview.runs.map((run) => (
                <li
                  key={run.id}
                  data-run={run.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">
                      {name(run.template.nameAr, run.template.nameEn)}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                      <AssessmentStatusBadge status={run.status} />
                      <span>
                        {t("list.runProgress", { scored: run.scoredCount, total: run.sampleSize })}
                      </span>
                      <span>
                        {run.submittedAt
                          ? t("list.submittedOn", { date: date(run.submittedAt) })
                          : t("list.startedOn", { date: date(run.startedAt) })}
                      </span>
                    </span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/tracers/runs/${run.id}`}>{t("list.open")}</Link>
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

async function TemplateCard({
  template,
  locale,
  title,
  date,
}: {
  template: TracerTemplateView;
  locale: Locale;
  title: string;
  date: (value: Date | string) => string;
}) {
  const t = await getTranslations({ locale, namespace: "tracers.list" });
  const scope = template.department
    ? localized(locale, template.department.nameAr, template.department.nameEn).text
    : t("wholeFacility");
  return (
    <li data-template={template.id}>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-lg font-semibold">{title}</h3>
            <CardDescription>
              {scope}
              {" · "}
              {template.chapterCount === 0
                ? t("allChapters")
                : t("chapters", { count: template.chapterCount })}
              {" · "}
              {t("perRun", { count: template.sampleSize })}
              {" · "}
              {t(`frequency.${template.frequency}`)}
            </CardDescription>
          </div>
          <DueBadge state={template.dueState} />
        </div>
        <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>{t(`due.${template.dueState}`, { date: date(template.dueOn) })}</span>
          <span>
            {template.lastRunOn ? t("lastRun", { date: date(template.lastRunOn) }) : t("neverRun")}
          </span>
        </p>
        <div className="flex flex-wrap items-start gap-2">
          {template.openRunId ? (
            <Button asChild size="lg">
              <Link href={`/tracers/runs/${template.openRunId}?step=1`}>{t("continue")}</Link>
            </Button>
          ) : template.canRun ? (
            <TracerActionButton
              fields={{ templateId: template.id }}
              label={t("start")}
              size="lg"
              action={startRunAction}
            />
          ) : null}
          {template.canManage ? (
            <TracerActionButton
              fields={{ templateId: template.id }}
              label={t("archive")}
              variant="ghost"
              action={archiveTemplateAction}
            />
          ) : null}
        </div>
      </Card>
    </li>
  );
}
