import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { evidenceLimits } from "@/modules/assessments/service";
import { AssessmentStatusBadge } from "@/modules/assessments/ui/AssessmentStatusBadge";
import { localized } from "@/modules/standards/service";
import { getRun, type TracerRunView } from "@/modules/tracers/service";
import { StepForm } from "@/modules/tracers/ui/StepForm";
import { TracerActionButton } from "@/modules/tracers/ui/TracerActionButton";
import { saveStepAction, submitRunAction } from "../../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tracers/runs/[runId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("tracers") };
}

export default async function TracerRunPage({
  params,
  searchParams,
}: PageProps<"/[locale]/tracers/runs/[runId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("tracers.run");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Link href="/tracers" className="text-primary text-sm hover:underline">
        {t("back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <RunBody locale={locale as Locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// The checks a tracer makes on the floor; documents are cited from the full assessment sheet.
const checkKinds = ["observation", "interview", "record_review"] as const;

type Element = TracerRunView["sheet"]["chapters"][number]["standards"][number]["elements"][number];

async function RunBody({
  locale,
  params,
  searchParams,
}: {
  locale: Locale;
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "tracers" });
  const tAssessments = await getTranslations({ locale, namespace: "assessments" });
  const ctx = await requireAppContext(locale);
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const view = await getRun(ctx.access, runId);
  if (!view || view.sheet.assessment.facilityId !== ctx.facilityId) notFound();
  const { sheet } = view;
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const elements = sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements));
  const levelLabel = new Map(
    sheet.scale.map((l) => [l.code, localized(locale, l.labelAr, l.labelEn).text || l.code]),
  );
  const title = t("run.title", { name: name(view.template.nameAr, view.template.nameEn) });
  const step = Number(typeof query.step === "string" ? query.step : NaN);
  const current = Number.isInteger(step) && step >= 1 && step <= elements.length ? step : null;

  const header = (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <AssessmentStatusBadge status={sheet.assessment.status} />
        <span data-testid="tracer-progress">
          {t("list.runProgress", { scored: sheet.progress.scored, total: sheet.progress.total })}
        </span>
      </p>
    </div>
  );

  if (sheet.assessment.status === "submitted") {
    return (
      <>
        {header}
        <Card className="flex flex-col gap-3" data-testid="tracer-result">
          <h2 className="text-lg font-semibold">{t("run.submittedTitle")}</h2>
          <p>
            {t("list.submittedOn", {
              date: formatDate(sheet.assessment.submittedAt!, locale, { style: "medium" }),
            })}
          </p>
          <p data-testid="tracer-findings">{t("run.findings", { count: sheet.findings.length })}</p>
          {sheet.findings.length > 0 && (
            <div>
              <Button asChild variant="outline">
                <Link href="/findings">{t("run.viewFindings")}</Link>
              </Button>
            </div>
          )}
        </Card>
        <ElementList elements={elements} levelLabel={levelLabel} locale={locale} />
        <SampleNote view={view} locale={locale} />
      </>
    );
  }

  if (!sheet.canScore) {
    return (
      <>
        {header}
        <Card>
          <CardDescription>{t("run.readOnly")}</CardDescription>
        </Card>
        <ElementList elements={elements} levelLabel={levelLabel} locale={locale} />
        <SampleNote view={view} locale={locale} />
      </>
    );
  }

  if (current === null) {
    return (
      <>
        {header}
        <h2 className="text-lg font-semibold">{t("run.reviewTitle")}</h2>
        <ElementList
          elements={elements}
          levelLabel={levelLabel}
          locale={locale}
          editHref={(index) => `/tracers/runs/${runId}?step=${index + 1}`}
        />
        <Card className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{t("run.submitHint")}</p>
          <TracerActionButton
            fields={{ runId }}
            label={t("run.submit")}
            size="lg"
            action={submitRunAction}
          />
        </Card>
        <SampleNote view={view} locale={locale} />
      </>
    );
  }

  const element = elements[current - 1]!;
  const esrLevels = new Set(sheet.esrAllowedLevels);
  const last = current === elements.length;
  return (
    <>
      {header}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium" data-testid="tracer-step">
          {t("run.step", { current, total: elements.length })}
        </p>
        <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${(current / elements.length) * 100}%` }}
          />
        </div>
      </div>
      <Card className="flex flex-col gap-3" data-element={element.code}>
        <div className="flex flex-wrap items-center gap-2">
          <bdi className="font-mono text-sm" dir="ltr">
            {element.code}
          </bdi>
          {element.isEsr ? <Badge variant="danger">{t("run.esr")}</Badge> : null}
        </div>
        <h2 className="text-lg font-semibold">{name(element.titleAr, element.titleEn)}</h2>
        {name(element.descriptionAr, element.descriptionEn) ? (
          <p className="text-muted-foreground">
            {name(element.descriptionAr, element.descriptionEn)}
          </p>
        ) : null}
        {element.score ? (
          <div className="border-border flex flex-col gap-1 border-t pt-3 text-sm">
            <p className="font-medium">
              {t("run.recorded")}
              {" · "}
              {t("run.levelOf", { level: levelLabel.get(element.score.levelCode) ?? "" })}
            </p>
            <ul className="text-muted-foreground flex flex-col gap-1">
              {element.score.evidence.map((e) => (
                <li key={e.id}>
                  {tAssessments(`evidenceKinds.${e.kind}`)}: {e.note ?? e.url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
      <StepForm
        key={element.id}
        runId={runId}
        elementId={element.id}
        step={current}
        levels={sheet.scale.map((l) => ({
          code: l.code,
          label: levelLabel.get(l.code)!,
          allowed: !element.isEsr || esrLevels.has(l.code),
        }))}
        current={element.score}
        isEsr={element.isEsr}
        checkKinds={checkKinds.map((kind) => ({
          value: kind,
          label: tAssessments(`evidenceKinds.${kind}`),
        }))}
        noteLimit={evidenceLimits.note}
        last={last}
        action={saveStepAction}
      />
      <nav className="flex flex-wrap justify-between gap-2" aria-label={t("run.reviewTitle")}>
        {current > 1 ? (
          <Button asChild variant="outline">
            <Link href={`/tracers/runs/${runId}?step=${current - 1}`}>{t("run.previous")}</Link>
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {!last ? (
            <Button asChild variant="ghost">
              <Link href={`/tracers/runs/${runId}?step=${current + 1}`}>{t("run.skip")}</Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href={`/tracers/runs/${runId}?step=review`}>{t("run.reviewLink")}</Link>
          </Button>
        </div>
      </nav>
    </>
  );
}

async function ElementList({
  elements,
  levelLabel,
  locale,
  editHref,
}: {
  elements: Element[];
  levelLabel: Map<string, string>;
  locale: Locale;
  editHref?: (index: number) => string;
}) {
  const t = await getTranslations({ locale, namespace: "tracers.run" });
  return (
    <Card className="p-0">
      <ol data-testid="tracer-elements">
        {elements.map((element, index) => (
          <li
            key={element.id}
            data-element={element.code}
            className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 first:border-t-0"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <bdi className="font-mono text-sm" dir="ltr">
                  {element.code}
                </bdi>
                {element.isEsr ? <Badge variant="danger">{t("esr")}</Badge> : null}
              </span>
              <span>{localized(locale, element.titleAr, element.titleEn).text}</span>
              <span
                className={element.score ? "text-sm font-medium" : "text-warning text-sm"}
                data-testid="tracer-element-level"
              >
                {element.score
                  ? t("levelOf", { level: levelLabel.get(element.score.levelCode) ?? "" })
                  : t("notChecked")}
              </span>
            </span>
            {editHref ? (
              <Button asChild variant="outline" size="sm">
                <Link href={editHref(index)}>{t("edit")}</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

async function SampleNote({ view, locale }: { view: TracerRunView; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "tracers.run" });
  return (
    <p className="text-muted-foreground text-xs" data-testid="tracer-sample-note">
      {t.rich("sampleNote", {
        pool: view.run.poolSize,
        seed: view.run.seed,
        code: (chunks) => (
          <bdi dir="ltr" className="font-mono break-all">
            {chunks}
          </bdi>
        ),
      })}{" "}
      {view.run.reproducible ? t("reproducible") : t("notReproducible")}
    </p>
  );
}
