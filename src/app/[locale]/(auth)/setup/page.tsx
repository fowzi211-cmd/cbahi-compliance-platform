import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardDescription } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireUser } from "@/lib/session";
import { listUserMemberships } from "@/modules/tenancy/service";
import { CreateOrganizationForm } from "@/modules/tenancy/ui/CreateOrganizationForm";
import { createOrganizationAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/setup">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "setup" });
  return { title: t("title") };
}

// First run for someone who signed up without an invitation: create the organization and
// its first facility. The full onboarding wizard (facility type, departments, standards)
// arrives in M5.
export default async function SetupPage({ params }: PageProps<"/[locale]/setup">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("setup");

  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CardDescription>{t("intro")}</CardDescription>
      <Suspense fallback={<Pending />}>
        <SetupBody locale={locale as Locale} />
      </Suspense>
    </Card>
  );
}

async function SetupBody({ locale }: { locale: Locale }) {
  const user = await requireUser(locale, "/setup");
  if ((await listUserMemberships(user.id)).length > 0) redirect({ href: "/", locale });
  return <CreateOrganizationForm action={createOrganizationAction} />;
}
