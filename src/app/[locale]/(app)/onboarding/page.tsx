import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { getOnboardingProgress } from "@/modules/tenancy/service";
import { OnboardingStepper } from "@/modules/tenancy/ui/OnboardingStepper";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "onboarding" });
  return { title: t("title") };
}

// The wizard's entry point: the first step not yet saved, or a summary once all are done.
export default async function OnboardingPage({ params }: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("onboarding");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
      <Suspense fallback={<Pending />}>
        <OnboardingSummary locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function OnboardingSummary({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  const ctx = await requireAppContext(locale);
  const progress = await getOnboardingProgress(ctx.access, ctx.facilityId);
  if (progress && !progress.onboardedAt && progress.next) {
    return redirect({ href: `/onboarding/${progress.next}`, locale });
  }

  return (
    <>
      <OnboardingStepper locale={locale} current={null} done={progress?.done ?? []} />
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("finished.title")}</CardTitle>
        <CardDescription>
          {progress?.onboardedAt
            ? t("finished.body", { date: formatDate(progress.onboardedAt, locale) })
            : t("finished.bodyNoDate")}
        </CardDescription>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/">{t("finished.toDashboard")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/standards">{t("finished.toLibrary")}</Link>
          </Button>
        </div>
      </Card>
    </>
  );
}
