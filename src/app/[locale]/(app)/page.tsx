import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { getDashboard, getTrend } from "@/modules/dashboards/service";
import {
  ExpiredEvidence,
  FacilityTiles,
  FrameworkOverview,
} from "@/modules/dashboards/ui/Overview";
import { allowed, getOnboardingProgress, onboardingSteps } from "@/modules/tenancy/service";

export default async function DashboardPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("dashboard");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense>
        <SetupReminder locale={locale as Locale} />
      </Suspense>
      <Suspense>
        <Overview locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

/**
 * The readiness overview (M13): per edition, readiness, ESR, breakdowns and the trend; then
 * the facility-wide tiles. Department heads and staff see their own departments only.
 */
async function Overview({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const ctx = await requireAppContext(locale);
  const [dashboard, trends] = await Promise.all([
    getDashboard(ctx.access, ctx.facilityId),
    getTrend(ctx.access, ctx.facilityId),
  ]);
  const anyScored = dashboard?.frameworks.some(
    (f) => (f.overview?.facility.scored ?? 0) > 0 || f.departments.some((d) => d.scored > 0),
  );

  return (
    <>
      {dashboard?.scope === "departments" && (
        <p className="text-muted-foreground text-sm" data-testid="department-scope">
          {t("departmentScope")}
        </p>
      )}
      {!anyScored && (
        <Card>
          <CardTitle>{t("emptyTitle")}</CardTitle>
          <CardDescription className="mt-2">{t("emptyBody")}</CardDescription>
        </Card>
      )}
      {dashboard?.facilityWide && (
        <FacilityTiles
          locale={locale}
          wide={dashboard.facilityWide}
          canEditSurvey={allowed(ctx.access, "facility.updateSettings", {
            facilityId: ctx.facilityId,
          })}
        />
      )}
      {dashboard?.frameworks.map((view) => (
        <FrameworkOverview
          key={view.framework.id}
          locale={locale}
          view={view}
          trend={trends.find((x) => x.frameworkId === view.framework.id) ?? null}
        />
      ))}
      {dashboard?.facilityWide && <ExpiredEvidence locale={locale} wide={dashboard.facilityWide} />}
    </>
  );
}

/** Until the owner finishes onboarding, the dashboard points them back to the wizard. */
async function SetupReminder({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const ctx = await requireAppContext(locale);
  if (!allowed(ctx.access, "facility.updateSettings", { facilityId: ctx.facilityId })) return null;
  const progress = await getOnboardingProgress(ctx.access, ctx.facilityId);
  if (!progress || progress.onboardedAt) return null;

  return (
    <Card className="border-primary/40 flex flex-col gap-3 border-s-4" data-testid="setup-reminder">
      <CardTitle>{t("setupTitle")}</CardTitle>
      <CardDescription>
        {t("setupBody", { done: progress.done.length, total: onboardingSteps.length })}
      </CardDescription>
      <div>
        <Button asChild>
          <Link href="/onboarding">{t("setupCta")}</Link>
        </Button>
      </div>
    </Card>
  );
}
