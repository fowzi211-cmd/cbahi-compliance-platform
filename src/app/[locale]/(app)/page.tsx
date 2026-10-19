import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";

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
      <Card>
        <CardTitle>{t("emptyTitle")}</CardTitle>
        <CardDescription className="mt-2">{t("emptyBody")}</CardDescription>
      </Card>
    </div>
  );
}
