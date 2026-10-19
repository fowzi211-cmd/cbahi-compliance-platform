import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";
import { Card, CardDescription } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { SignUpForm } from "@/modules/identity/ui/SignUpForm";
import { findInvitationByToken } from "@/modules/tenancy/service";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "auth.signUp" });
  return { title: t("title") };
}

const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("auth.signUp");

  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<Pending />}>
        <SignUpBody locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </Card>
  );
}

async function SignUpBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: PageProps<"/[locale]/sign-up">["searchParams"];
}) {
  const query = await searchParams;
  // Invitation status depends on the current time.
  await connection();
  const token = inviteToken.safeParse(query.invite);
  const invitation = token.success ? await findInvitationByToken(token.data) : null;
  // Only an open invitation fixes the email; anything else is a normal sign-up.
  const invited = token.success && invitation?.status === "pending" ? token.data : null;
  const t = await getTranslations({ locale, namespace: "auth.signUp" });

  return (
    <>
      <CardDescription>{invited ? t("introInvited") : t("intro")}</CardDescription>
      <SignUpForm
        invitedEmail={invited ? invitation?.email : undefined}
        afterSignUp={invited ? `/invite/${invited}` : "/setup"}
      />
      <p className="text-muted-foreground text-sm">
        {t("haveAccount")}{" "}
        <Link
          href={invited ? `/sign-in?next=/invite/${invited}` : "/sign-in"}
          className="text-primary font-medium underline"
        >
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
