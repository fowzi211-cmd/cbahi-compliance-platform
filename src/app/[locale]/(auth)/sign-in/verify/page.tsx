import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardDescription } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import type { Locale } from "@/i18n/routing";
import { safeNext } from "@/lib/safe-next";
import { TwoFactorVerifyForm } from "@/modules/identity/ui/TwoFactorVerifyForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sign-in/verify">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "auth.verify" });
  return { title: t("title") };
}

export default async function VerifyPage({
  params,
  searchParams,
}: PageProps<"/[locale]/sign-in/verify">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("auth.verify");

  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CardDescription>{t("intro")}</CardDescription>
      <Suspense fallback={<Pending />}>
        <VerifyBody searchParams={searchParams} />
      </Suspense>
    </Card>
  );
}

async function VerifyBody({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/sign-in/verify">["searchParams"];
}) {
  const query = await searchParams;
  return (
    <TwoFactorVerifyForm next={safeNext(typeof query.next === "string" ? query.next : null)} />
  );
}
