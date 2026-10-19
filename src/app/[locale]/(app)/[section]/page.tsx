import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { sectionMilestones } from "@/components/shell/nav-items";
import { Card, CardDescription } from "@/components/ui/card";
import { routing, type Locale } from "@/i18n/routing";

// Placeholder pages for modules that later milestones deliver, so the shell is navigable now.
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    Object.keys(sectionMilestones).map((section) => ({ locale, section })),
  );
}

export default async function SectionPlaceholder({ params }: PageProps<"/[locale]/[section]">) {
  const { locale, section } = await params;
  const item = sectionMilestones[section];
  if (!item) notFound();
  setRequestLocale(locale as Locale);
  const t = await getTranslations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t(`nav.${item.key}`)}</h1>
      <Card>
        <CardDescription>
          {t("common.availableIn", { milestone: item.milestone ?? "" })}
        </CardDescription>
      </Card>
    </div>
  );
}
