import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, Label } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requirePlatformAdmin } from "@/lib/session";
import { browseEdition, limits, localized } from "@/modules/standards/service";
import { LibraryBrowser } from "@/modules/standards/ui/LibraryBrowser";
import { StatusBadge } from "@/modules/standards/ui/StatusBadge";
import { parseBrowseParams } from "@/modules/standards/ui/browse-params";
import {
  activateEditionAction,
  deleteDraftAction,
  retireEditionAction,
  setLicenseNoteAction,
} from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/standards/[frameworkId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "platform.standards" });
  return { title: t("edition.title") };
}

export default async function EditionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/platform/standards/[frameworkId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.standards");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/platform/standards" className="text-primary text-sm hover:underline">
        {t("back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <Edition locale={locale as Locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Edition({
  locale,
  params,
  searchParams,
}: {
  locale: Locale;
  params: Promise<{ frameworkId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "platform.standards" });
  const user = await requirePlatformAdmin(locale);
  const { frameworkId } = await params;
  const query = await searchParams;
  const filter = parseBrowseParams(query);
  const data = await browseEdition(
    { userId: user.id, isPlatformAdmin: user.isPlatformAdmin },
    frameworkId,
    filter,
  );
  if (!data) notFound();
  const { edition } = data;
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-3xl">
          {localized(locale, edition.nameAr, edition.nameEn).text}
          <StatusBadge status={edition.status} />
        </h1>
        <p className="text-muted-foreground text-sm">
          <bdi dir="ltr">
            {edition.code} {edition.edition}
          </bdi>
          {edition.activatedAt && (
            <> · {t("edition.activatedOn", { date: formatDate(edition.activatedAt, locale) })}</>
          )}
          {edition.retiredAt && (
            <> · {t("edition.retiredOn", { date: formatDate(edition.retiredAt, locale) })}</>
          )}
        </p>
      </div>

      {error && <Alert tone="danger">{t(`errors.${error as "invalid"}`)}</Alert>}

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("edition.license")}</CardTitle>
        {edition.status === "retired" ? (
          <CardDescription>{edition.licenseNote}</CardDescription>
        ) : (
          <form action={setLicenseNoteAction} className="flex flex-col gap-3">
            <input type="hidden" name="frameworkId" value={edition.id} />
            <Field>
              <Label htmlFor="license-note">{t("edition.licenseLabel")}</Label>
              <textarea
                id="license-note"
                name="licenseNote"
                rows={3}
                maxLength={limits.licenseNoteLength}
                defaultValue={edition.licenseNote ?? ""}
                aria-describedby="license-hint"
                className="border-border bg-background focus-visible:ring-ring rounded-md border p-3 text-base focus-visible:ring-2 focus-visible:outline-none"
              />
              <FieldHint id="license-hint">{t("edition.licenseHint")}</FieldHint>
            </Field>
            <div>
              <Button type="submit" variant="outline">
                {t("edition.saveLicense")}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {edition.status !== "retired" && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("edition.lifecycle")}</CardTitle>
          <CardDescription>
            {edition.status === "draft" ? t("edition.draftHint") : t("edition.activeHint")}
          </CardDescription>
          <div className="flex flex-wrap gap-3">
            {edition.status === "draft" && (
              <>
                <form action={activateEditionAction}>
                  <input type="hidden" name="frameworkId" value={edition.id} />
                  <Button type="submit">{t("edition.activate")}</Button>
                </form>
                <form action={deleteDraftAction}>
                  <input type="hidden" name="frameworkId" value={edition.id} />
                  <Button type="submit" variant="outline">
                    {t("edition.delete")}
                  </Button>
                </form>
              </>
            )}
            {edition.status === "active" && (
              <form action={retireEditionAction}>
                <input type="hidden" name="frameworkId" value={edition.id} />
                <Button type="submit" variant="outline">
                  {t("edition.retire")}
                </Button>
              </form>
            )}
          </div>
        </Card>
      )}

      <h2 className="text-xl font-bold">{t("edition.content")}</h2>
      <LibraryBrowser
        locale={locale}
        data={data}
        filter={filter}
        path={`/platform/standards/${edition.id}`}
      />
    </>
  );
}
