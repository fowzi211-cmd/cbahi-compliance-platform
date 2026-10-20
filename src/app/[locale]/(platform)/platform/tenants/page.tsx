import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { Field, Input, Label } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requirePlatformAdmin } from "@/lib/session";
import { listTenants } from "@/modules/subscriptions/service";
import { TierBadge } from "@/modules/subscriptions/ui/Badges";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/tenants">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "platform.tenants" });
  return { title: t("title") };
}

export default async function TenantsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/platform/tenants">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.tenants");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <Tenants locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Tenants({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "platform.tenants" });
  const user = await requirePlatformAdmin(locale);
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const tenants = await listTenants({ userId: user.id, isPlatformAdmin: true }, query);

  return (
    <>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <Field className="min-w-0 flex-1">
          <Label htmlFor="tenant-search">{t("search")}</Label>
          <Input id="tenant-search" name="q" type="search" defaultValue={query} />
        </Field>
        <Button type="submit" variant="outline">
          {t("searchButton")}
        </Button>
      </form>
      {tenants.length === 0 ? (
        <Card>
          <CardDescription>{t("empty")}</CardDescription>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="tenant-list">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/platform/tenants/${tenant.id}`}
                    className="font-semibold underline"
                    dir="auto"
                  >
                    {tenant.name}
                  </Link>
                  <CardDescription>
                    {t("summary", {
                      facilities: tenant.facilities,
                      date: formatDate(tenant.createdAt, locale, { style: "medium" }),
                    })}
                  </CardDescription>
                </div>
                {tenant.subscription && (
                  <TierBadge locale={locale} tier={tenant.subscription.effectiveTier} />
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
