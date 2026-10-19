import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { safeNext } from "@/lib/safe-next";
import { getSession } from "@/lib/session";
import { SignInForm } from "@/modules/identity/ui/SignInForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "auth.signIn" });
  return { title: t("title") };
}

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("auth");

  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("signIn.title")}</h1>
      <Suspense fallback={<Pending />}>
        <SignInBody locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
      <p className="text-muted-foreground text-sm">
        {t("signIn.noAccount")}{" "}
        <Link href="/sign-up" className="text-primary font-medium underline">
          {t("signIn.createAccount")}
        </Link>
      </p>
    </Card>
  );
}

async function SignInBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: PageProps<"/[locale]/sign-in">["searchParams"];
}) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === "string" ? query.next : null);
  if (await getSession()) redirect({ href: next, locale });
  const t = await getTranslations({ locale, namespace: "auth.signIn" });
  return (
    <>
      {query.expired ? <Alert>{t("expired")}</Alert> : null}
      <SignInForm next={next} />
    </>
  );
}
