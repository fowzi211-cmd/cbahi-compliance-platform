import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { allowed, getOnboardingProgress, onboardingSteps } from "@/modules/tenancy/service";

export default async function DashboardPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("dashboard");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense>
        <SetupReminder locale={locale as Locale} />
      </Suspense>
      <Card>
        <CardTitle>{t("emptyTitle")}</CardTitle>
        <CardDescription className="mt-2">{t("emptyBody")}</CardDescription>
      </Card>
    </div>
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
