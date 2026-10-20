import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, Input, Label } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/session";
import { localized } from "@/modules/standards/service";
import { listConsultantAccounts } from "@/modules/subscriptions/service";
import { Feedback } from "@/modules/subscriptions/ui/Badges";
import { setConsultantAction } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/consultants">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "platform.consultants" });
  return { title: t("title") };
}

export default async function ConsultantsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/platform/consultants">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.consultants");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <Consultants locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Consultants({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "platform.consultants" });
  const user = await requirePlatformAdmin(locale);
  const consultants = await listConsultantAccounts({ userId: user.id, isPlatformAdmin: true });

  return (
    <>
      <Feedback locale={locale} query={await searchParams} />
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("add")}</CardTitle>
        <form action={setConsultantAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="grant" value="true" />
          <Field className="min-w-0 flex-1">
            <Label htmlFor="consultant-email">{t("email")}</Label>
            <Input
              id="consultant-email"
              name="email"
              type="email"
              dir="ltr"
              required
              aria-describedby="consultant-email-hint"
            />
          </Field>
          <Button type="submit">{t("addButton")}</Button>
        </form>
        <FieldHint id="consultant-email-hint">{t("emailHint")}</FieldHint>
      </Card>

      {consultants.length === 0 ? (
        <Card>
          <CardDescription>{t("empty")}</CardDescription>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="consultant-list">
          {consultants.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{c.name}</span>
                    <bdi dir="ltr" className="text-muted-foreground text-sm">
                      {c.email}
                    </bdi>
                  </div>
                  <div className="flex items-center gap-2">
                    {!c.twoFactorEnabled && <Badge variant="warning">{t("noMfa")}</Badge>}
                    <form action={setConsultantAction}>
                      <input type="hidden" name="email" value={c.email} />
                      <input type="hidden" name="grant" value="false" />
                      <Button type="submit" variant="outline" size="sm">
                        {t("remove")}
                      </Button>
                    </form>
                  </div>
                </div>
                {c.assignments.length === 0 ? (
                  <CardDescription>{t("noAssignments")}</CardDescription>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {c.assignments.map((a) => (
                      <li key={a.id}>
                        <Link href={`/platform/tenants/${a.tenantId}`} className="underline">
                          <span dir="auto">{a.tenantName}</span>
                        </Link>{" "}
                        · {localized(locale, a.facilityNameAr, a.facilityNameEn).text}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
