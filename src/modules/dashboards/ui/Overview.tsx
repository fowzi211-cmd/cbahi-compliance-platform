import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { formatPercent } from "@/lib/numbers";
import { localized } from "@/modules/standards/service";
import { readyScore, type Dashboard, type FrameworkTrend } from "../service";
import { TrendChart } from "./TrendChart";

type FrameworkView = Dashboard["frameworks"][number];
type Overview = NonNullable<FrameworkView["overview"]>;
type FacilityWide = NonNullable<Dashboard["facilityWide"]>;

const statusVariant = { not_ready: "danger", at_risk: "warning", ready: "success" } as const;
const esrVariant = { met: "success", notMet: "danger", unverified: "warning" } as const;
const countdownVariant = {
  unknown: "default",
  later: "success",
  soon: "warning",
  imminent: "danger",
  passed: "danger",
} as const;

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/** Library or facility text in the reader's language, marked when it falls back. */
function Text({ locale, ar, en }: { locale: Locale; ar: string | null; en: string | null }) {
  const value = localized(locale, ar, en);
  return value.missing ? (
    <span lang={value.lang} dir="auto">
      {value.text}
    </span>
  ) : (
    <>{value.text}</>
  );
}

function ElementLabel({
  locale,
  element,
}: {
  locale: Locale;
  element: { code: string; titleAr: string | null; titleEn: string | null };
}) {
  return (
    <>
      <bdi className="font-medium">{element.code}</bdi>{" "}
      <Text locale={locale} ar={element.titleAr} en={element.titleEn} />
    </>
  );
}

function Panel({
  title,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card className={`flex flex-col gap-3 p-5 ${className ?? ""}`} data-testid={testId}>
      <h3 className="font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

/**
 * Scores as bars. The percentage is always written next to the bar, so the bar only
 * repeats the number for the eye and is hidden from assistive technology.
 */
function ScoreBars({
  rows,
  noScore,
}: {
  rows: { key: string; label: ReactNode; score: number | null; detail: string }[];
  noScore: string;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{row.label}</span>
            <span className="font-medium whitespace-nowrap">
              {row.score === null ? noScore : formatPercent(row.score)}
            </span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
            {row.score !== null && (
              <div
                className="bg-chart-internal h-full rounded-full"
                style={{ width: `${Math.round(row.score * 100)}%` }}
              />
            )}
          </div>
          <span className="text-muted-foreground text-xs">{row.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** One edition: readiness, the ESR panel, the breakdowns and what still needs verifying. */
export async function FrameworkOverview({
  locale,
  view,
  trend,
}: {
  locale: Locale;
  view: FrameworkView;
  trend: FrameworkTrend | null;
}) {
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const name =
    localized(locale, view.framework.nameAr, view.framework.nameEn).text || view.framework.code;
  const o = view.overview;

  const departments = (
    <Panel title={t("departments.title")} testId="department-scores">
      {view.departments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("departments.empty")}</p>
      ) : (
        <ScoreBars
          noScore={t("readiness.noScore")}
          rows={view.departments.map((d) => ({
            key: d.departmentId,
            label: <Text locale={locale} ar={d.department.nameAr} en={d.department.nameEn} />,
            score: d.score,
            detail: t("readiness.coverage", { scored: d.scored, counted: d.counted }),
          }))}
        />
      )}
    </Panel>
  );

  return (
    <section className="flex flex-col gap-4" data-testid="framework-overview">
      <h2 className="text-xl font-semibold">{name}</h2>
      {o ? (
        <>
          {o.status === "not_ready" && <NotReadyBanner locale={locale} overview={o} />}
          <div className="grid gap-4 lg:grid-cols-3">
            <ReadinessCard locale={locale} overview={o} />
            <EsrPanel locale={locale} overview={o} />
          </div>
          <TrendPanel locale={locale} trend={trend} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("chapters.title")} testId="chapter-scores">
              <ScoreBars
                noScore={t("readiness.noScore")}
                rows={o.chapters.map((c) => ({
                  key: c.chapterId,
                  label: (
                    <>
                      <bdi className="font-medium">{c.chapter.code}</bdi>{" "}
                      <Text locale={locale} ar={c.chapter.titleAr} en={c.chapter.titleEn} />
                    </>
                  ),
                  score: c.score,
                  detail: t("readiness.coverage", { scored: c.scored, counted: c.counted }),
                }))}
              />
            </Panel>
            {departments}
          </div>
          <UnverifiedPanel locale={locale} overview={o} />
        </>
      ) : (
        departments
      )}
    </section>
  );
}

async function NotReadyBanner({ locale, overview }: { locale: Locale; overview: Overview }) {
  const t = await getTranslations({ locale, namespace: "dashboard.banner" });
  return (
    <Alert tone="danger" className="flex flex-col gap-1" data-testid="not-ready-banner">
      <strong>{t("title")}</strong>
      <ul className="list-disc ps-5">
        {overview.reasons.map((reason) => (
          <li key={reason}>{t(`reasons.${reason}`)}</li>
        ))}
      </ul>
    </Alert>
  );
}

async function ReadinessCard({ locale, overview: o }: { locale: Locale; overview: Overview }) {
  const t = await getTranslations({ locale, namespace: "dashboard.readiness" });
  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="readiness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t("title")}</h3>
        <Badge variant={statusVariant[o.status]} data-testid="readiness-status">
          {t(`status.${o.status}`)}
        </Badge>
      </div>
      <p className="text-3xl font-bold" data-testid="readiness-score">
        {o.facility.score === null ? t("noScore") : formatPercent(o.facility.score)}
      </p>
      <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
        <li data-testid="readiness-coverage">
          {t("coverage", { scored: o.facility.scored, counted: o.facility.counted })}
        </li>
        {o.expired > 0 && <li>{t("expired", { count: o.expired })}</li>}
        {o.consultant && (
          <li data-testid="readiness-consultant">
            {t("consultant", {
              score: o.consultant.score === null ? t("noScore") : formatPercent(o.consultant.score),
              status: t(`status.${o.consultant.status}`),
            })}
          </li>
        )}
      </ul>
      <Link href="/assessments" className="text-primary text-sm font-medium underline">
        {t("cta")}
      </Link>
    </Card>
  );
}

/** ESR elements that are not met or not verified first: any one of them fails the survey. */
async function EsrPanel({ locale, overview: o }: { locale: Locale; overview: Overview }) {
  const t = await getTranslations({ locale, namespace: "dashboard.esr" });
  const failing = o.esr.filter((e) => e.state !== "met");
  const met = o.esr.length - failing.length;
  return (
    <Panel title={t("title")} className="lg:col-span-2" testId="esr-panel">
      <p className="text-sm" data-testid="esr-summary">
        {o.esr.length === 0 ? t("none") : t("summary", { met, total: o.esr.length })}
      </p>
      {failing.length > 0 && (
        <ul className="divide-border flex flex-col divide-y text-sm">
          {failing.map((e) => (
            <li key={e.elementId} className="flex items-start justify-between gap-3 py-2">
              <span>
                <ElementLabel locale={locale} element={e.element} />
              </span>
              <Badge variant={esrVariant[e.state]}>{t(`states.${e.state}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function UnverifiedPanel({ locale, overview: o }: { locale: Locale; overview: Overview }) {
  const t = await getTranslations({ locale, namespace: "dashboard.unverified" });
  return (
    <Panel title={t("title")} testId="unverified-panel">
      {o.unverifiedTotal === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{t("intro")}</p>
          <ul className="divide-border flex flex-col divide-y text-sm">
            {o.unverified.map((u) => (
              <li key={u.elementId} className="flex items-start justify-between gap-3 py-2">
                <span>
                  <ElementLabel locale={locale} element={u.element} />
                  {u.isEsr && (
                    <>
                      {" "}
                      <Badge variant="danger">{t("esr")}</Badge>
                    </>
                  )}
                </span>
                <Badge variant={u.state === "expired" ? "warning" : "default"}>
                  {t(`states.${u.state}`)}
                </Badge>
              </li>
            ))}
          </ul>
          {o.unverifiedTotal > o.unverified.length && (
            <p className="text-muted-foreground text-sm">
              {t("more", { count: o.unverifiedTotal - o.unverified.length })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

async function TrendPanel({ locale, trend }: { locale: Locale; trend: FrameworkTrend | null }) {
  const t = await getTranslations({ locale, namespace: "dashboard.trend" });
  const points = (trend?.points ?? []).map((p) => ({
    ...p,
    label: formatDate(day(p.day), locale, { style: "medium" }),
  }));
  const pct = (v: number | null) => (v === null ? "–" : formatPercent(v));
  const hasConsultant = points.some((p) => p.consultant !== null);
  return (
    <Panel title={t("title")} testId="trend">
      {points.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <>
          <TrendChart
            points={points}
            threshold={readyScore}
            labels={{
              internal: t("internal"),
              consultant: t("consultant"),
              threshold: t("threshold", { score: formatPercent(readyScore) }),
              chart: t("chart", { days: points.length }),
            }}
          />
          <details className="text-sm">
            <summary className="text-primary cursor-pointer font-medium">{t("table")}</summary>
            {/* Six months of nights make this scroll; keyboard users must be able to reach it. */}
            <div
              className="mt-2 max-h-64 overflow-auto"
              role="region"
              aria-label={t("table")}
              tabIndex={0}
            >
              <table className="w-full text-start">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-start font-medium">{t("day")}</th>
                    <th className="py-1 text-start font-medium">{t("internal")}</th>
                    {hasConsultant && (
                      <th className="py-1 text-start font-medium">{t("consultant")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.day} className="border-border border-t">
                      <td className="py-1">{p.label}</td>
                      <td className="py-1">{pct(p.internal)}</td>
                      {hasConsultant && <td className="py-1">{pct(p.consultant)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Panel>
  );
}

/** Facility-wide tiles: corrective actions, documents, the survey countdown. */
export async function FacilityTiles({
  locale,
  wide,
  canEditSurvey,
}: {
  locale: Locale;
  wide: FacilityWide;
  canEditSurvey: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const { capa, documents, survey } = wide;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Panel title={t("capa.title")} testId="capa-tile">
        <p className="text-3xl font-bold">{capa?.active ?? 0}</p>
        <p className="text-sm">{t("capa.active")}</p>
        <p
          className={`text-sm ${capa && capa.overdue > 0 ? "text-danger font-medium" : "text-muted-foreground"}`}
          data-testid="capa-overdue"
        >
          {t("capa.overdue", { count: capa?.overdue ?? 0 })}
        </p>
        <Link href="/findings" className="text-primary text-sm font-medium underline">
          {t("capa.cta")}
        </Link>
      </Panel>

      <Panel title={t("documents.title")} testId="documents-tile">
        <ul className="flex flex-col gap-1 text-sm">
          <li data-testid="documents-expiring">
            {t("documents.expiring", { count: documents.expiring.length })}
          </li>
          <li
            className={documents.expired.length > 0 ? "text-danger font-medium" : undefined}
            data-testid="documents-expired"
          >
            {t("documents.expired", { count: documents.expired.length })}
          </li>
          <li>{t("documents.reviewDue", { count: documents.reviewDue })}</li>
        </ul>
        {documents.expiring.length > 0 && (
          <ul className="divide-border flex flex-col divide-y text-sm">
            {documents.expiring.slice(0, 5).map((d) => (
              <li key={d.versionId} className="flex justify-between gap-3 py-1.5">
                <Link href={`/documents/${d.documentId}`} className="underline">
                  <Text locale={locale} ar={d.titleAr} en={d.titleEn} />
                </Link>
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatDate(day(d.expiresOn), locale, { style: "medium" })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/documents" className="text-primary text-sm font-medium underline">
          {t("documents.cta")}
        </Link>
      </Panel>

      <Panel title={t("survey.title")} testId="survey-countdown">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-3xl font-bold" data-testid="survey-days">
            {survey.days === null || survey.days < 0 ? "–" : survey.days}
          </p>
          <Badge variant={countdownVariant[survey.state]}>
            {t(`survey.states.${survey.state}`)}
          </Badge>
        </div>
        <p className="text-sm">
          {survey.nextExpectedOn
            ? survey.state === "passed"
              ? t("survey.passed", { date: formatDate(day(survey.nextExpectedOn), locale) })
              : t("survey.on", {
                  date: formatDate(day(survey.nextExpectedOn), locale),
                  days: survey.days ?? 0,
                })
            : t("survey.unknown")}
        </p>
        {canEditSurvey && (
          <Link href="/onboarding/survey" className="text-primary text-sm font-medium underline">
            {t("survey.cta")}
          </Link>
        )}
      </Panel>
    </div>
  );
}

/** Scores in force that lean on a document which has since expired. */
export async function ExpiredEvidence({ locale, wide }: { locale: Locale; wide: FacilityWide }) {
  if (wide.expiredEvidence.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "dashboard.expiredEvidence" });
  return (
    <Panel title={t("title")} testId="expired-evidence">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      <ul className="divide-border flex flex-col divide-y text-sm">
        {wide.expiredEvidence.map((x) => (
          <li
            key={`${x.element.id}-${x.document.versionId}`}
            className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2"
          >
            <span>
              <ElementLabel locale={locale} element={x.element} />
            </span>
            <Link href={`/documents/${x.document.documentId}`} className="underline">
              {t("document", {
                title: localized(locale, x.document.titleAr, x.document.titleEn).text,
                date: formatDate(day(x.document.expiresOn), locale, { style: "medium" }),
              })}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
