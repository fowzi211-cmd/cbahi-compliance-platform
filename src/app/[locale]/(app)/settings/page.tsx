import { ChevronRight, Download } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { canExportData } from "@/modules/governance/service";
import { getSubscriptionOverview } from "@/modules/subscriptions/service";
import { TierBadge } from "@/modules/subscriptions/ui/Badges";
import { onboardingSteps } from "@/modules/tenancy/service";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/settings">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("settings") };
}

// Facility settings are the onboarding steps, reachable at any time after setup. The step
// pages check the owner's permission themselves.
export default async function SettingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.settings")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("settings.intro")}</p>
      </div>
      <Card className="p-0">
        <ul>
          {onboardingSteps.map((step) => (
            <li key={step} className="border-border border-t first:border-t-0">
              <Link
                href={`/onboarding/${step}`}
                className="hover:bg-muted flex items-center justify-between gap-4 px-5 py-4"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-medium">{t(`onboarding.steps.${step}`)}</span>
                  <span className="text-muted-foreground text-sm">
                    {t(`onboarding.hints.${step}`)}
                  </span>
                </span>
                <ChevronRight
                  className="text-muted-foreground size-5 shrink-0 rtl:-scale-x-100"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Suspense>
        <Subscription locale={locale as Locale} />
      </Suspense>
      <Suspense>
        <DataExport locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const day = (value: string) => new Date(`${value}T12:00:00Z`);

/**
 * The plan and who outside the staff can read the facility's data (owner only). The tier is
 * changed by the platform team, so this section only shows it.
 */
async function Subscription({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "settings.subscription" });
  const ts = await getTranslations({ locale, namespace: "subscriptions" });
  const ctx = await requireAppContext(locale);
  const sub = await getSubscriptionOverview(ctx.access, ctx.facilityId);
  if (!sub) return null;
  return (
    <Card className="flex flex-col gap-4" data-testid="subscription">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <TierBadge locale={locale} tier={sub.effectiveTier} />
      </div>
      <CardDescription>
        {sub.endsOn
          ? t("term", {
              start: formatDate(day(sub.startsOn), locale),
              end: formatDate(day(sub.endsOn), locale),
            })
          : t("since", { start: formatDate(day(sub.startsOn), locale) })}
      </CardDescription>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("features")}</h3>
        <ul className="flex flex-wrap gap-2 text-sm">
          {sub.enabled.length === 0 ? (
            <li className="text-muted-foreground">{t("noFeatures")}</li>
          ) : (
            sub.enabled.map((f) => (
              <li key={f} className="bg-muted rounded-full px-3 py-1">
                {ts(`features.${f}`)}
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("consultants")}</h3>
        {sub.consultants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noConsultants")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="facility-consultants">
            {sub.consultants.map((c) => (
              <li key={c.email}>
                {t("consultant", {
                  name: c.name,
                  date: formatDate(c.since, locale, { style: "medium" }),
                })}{" "}
                <bdi dir="ltr" className="text-muted-foreground">
                  {c.email}
                </bdi>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-sm">{t("consultantsHint")}</p>
      </div>
    </Card>
  );
}

/**
 * The organization's data export (owner of every facility only). A plain form POST: the
 * route answers with the ZIP as a download, or comes back here with the reason it refused.
 */
async function DataExport({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "settings.export" });
  const ctx = await requireAppContext(locale);
  if (!(await canExportData(ctx.access))) return null;
  const { export: refused } = await searchParams;
  return (
    <Card id="export" className="flex flex-col gap-4" data-testid="data-export">
      <CardTitle>{t("title")}</CardTitle>
      <CardDescription>{t("body")}</CardDescription>
      {refused === "rateLimited" || refused === "forbidden" ? (
        <Alert tone="danger">{t(refused)}</Alert>
      ) : null}
      <form method="post" action={getPathname({ href: "/settings/export", locale })}>
        <Button type="submit" variant="outline">
          <Download aria-hidden />
          {t("button")}
        </Button>
      </form>
    </Card>
  );
}
