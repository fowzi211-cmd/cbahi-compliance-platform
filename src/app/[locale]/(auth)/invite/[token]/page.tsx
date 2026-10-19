import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSession } from "@/lib/session";
import { findInvitationByToken } from "@/modules/tenancy/service";
import { AcceptInvitationForm } from "@/modules/tenancy/ui/AcceptInvitationForm";
import { acceptInvitationAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/invite/[token]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "invite" });
  // The token is a secret: keep these pages out of search engines and referrers.
  return { title: t("title"), robots: { index: false }, referrer: "no-referrer" };
}

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  return (
    <Suspense fallback={<Pending />}>
      <InviteBody params={params} />
    </Suspense>
  );
}

async function InviteBody({ params }: { params: PageProps<"/[locale]/invite/[token]">["params"] }) {
  const { locale, token } = await params;
  // Invitation status depends on the current time, so this always renders per request.
  await connection();
  setRequestLocale(locale as Locale);
  const t = await getTranslations();
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  const invitation = valid ? await findInvitationByToken(token) : null;

  if (!invitation || invitation.status !== "pending") {
    const reason = (invitation?.status ?? "notFound") as
      "notFound" | "expired" | "revoked" | "accepted";
    return (
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("invite.title")}</h1>
        <Alert tone="warning">{t(`invite.errors.${reason}`)}</Alert>
        <Link href="/sign-in" className={buttonVariants({ variant: "outline" })}>
          {t("invite.goToSignIn")}
        </Link>
      </Card>
    );
  }

  const session = await getSession();
  const facility = locale === "ar" ? invitation.facilityNameAr : invitation.facilityNameEn;
  const sameUser = session?.user.email.toLowerCase() === invitation.email;

  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("invite.title")}</h1>
      <p>
        {t.rich("invite.summary", {
          facility,
          role: t(`roles.${invitation.role}`),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
      <p className="text-muted-foreground text-sm">
        {t.rich("invite.forEmail", {
          email: invitation.email,
          bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
        })}
      </p>
      {!session ? (
        <div className="flex flex-col gap-3">
          <Link href={`/sign-up?invite=${token}`} className={buttonVariants({ size: "lg" })}>
            {t("invite.createAccount")}
          </Link>
          <Link
            href={`/sign-in?next=/invite/${token}`}
            className={buttonVariants({ variant: "outline" })}
          >
            {t("invite.haveAccount")}
          </Link>
        </div>
      ) : sameUser ? (
        <AcceptInvitationForm token={token} action={acceptInvitationAction} />
      ) : (
        <div className="flex flex-col gap-3">
          <Alert tone="warning">
            {t.rich("invite.wrongAccount", {
              email: session.user.email,
              bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
            })}
          </Alert>
          <SignOutButton userName="" redirectTo={`/invite/${token}`} />
        </div>
      )}
    </Card>
  );
}
