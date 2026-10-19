import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardDescription } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireUser } from "@/lib/session";
import { mfaRequired } from "@/modules/identity/service";
import { MfaEnrollForm } from "@/modules/identity/ui/MfaEnrollForm";

export async function generateMetadata({ params }: PageProps<"/[locale]/mfa">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "auth.mfa" });
  return { title: t("title") };
}

export default async function MfaPage({ params }: PageProps<"/[locale]/mfa">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("auth.mfa");

  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<Pending />}>
        <MfaBody locale={locale as Locale} />
      </Suspense>
    </Card>
  );
}

async function MfaBody({ locale }: { locale: Locale }) {
  const user = await requireUser(locale, "/mfa");
  if (user.twoFactorEnabled) redirect({ href: "/", locale });
  const t = await getTranslations({ locale, namespace: "auth.mfa" });
  return (
    <>
      <CardDescription>
        {(await mfaRequired(user)) ? t("requiredIntro") : t("optionalIntro")}
      </CardDescription>
      <MfaEnrollForm />
    </>
  );
}
