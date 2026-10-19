import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { browseLibrary, localized } from "@/modules/standards/service";
import { LibraryBrowser } from "@/modules/standards/ui/LibraryBrowser";
import { parseBrowseParams } from "@/modules/standards/ui/browse-params";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/standards/[frameworkId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("standards") };
}

export default async function FrameworkPage({
  params,
  searchParams,
}: PageProps<"/[locale]/standards/[frameworkId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("standards");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/standards" className="text-primary text-sm hover:underline">
        {t("browse.back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <FrameworkBody locale={locale as Locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FrameworkBody({
  locale,
  params,
  searchParams,
}: {
  locale: Locale;
  params: Promise<{ frameworkId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "standards" });
  const ctx = await requireAppContext(locale);
  const { frameworkId } = await params;
  const filter = parseBrowseParams(await searchParams);
  const data = await browseLibrary(ctx.access, frameworkId, filter);
  if (!data) notFound();
  const { edition } = data;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">
          {localized(locale, edition.nameAr, edition.nameEn).text}
        </h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <bdi dir="ltr">{edition.code}</bdi>
          <span>{t("library.edition", { edition: edition.edition })}</span>
          {edition.status === "retired" && <Badge variant="warning">{t("status.retired")}</Badge>}
        </p>
      </div>
      <LibraryBrowser
        locale={locale}
        data={data}
        filter={filter}
        path={`/standards/${frameworkId}`}
      />
      {edition.licenseNote && (
        <p className="text-muted-foreground border-border border-t pt-4 text-xs">
          {t("browse.license", { note: edition.licenseNote })}
        </p>
      )}
    </>
  );
}
