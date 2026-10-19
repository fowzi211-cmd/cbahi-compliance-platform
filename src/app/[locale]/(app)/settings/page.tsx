import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
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
export default async function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
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
    </div>
  );
}
