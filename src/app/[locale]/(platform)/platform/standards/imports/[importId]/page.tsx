import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/session";
import { getImport, localized } from "@/modules/standards/service";
import { DiffSummary } from "@/modules/standards/ui/DiffSummary";
import { IssueList } from "@/modules/standards/ui/IssueList";
import { commitImportAction, discardImportAction } from "../../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/standards/imports/[importId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "platform.standards.preview",
  });
  return { title: t("title") };
}

export default async function ImportPreviewPage({
  params,
  searchParams,
}: PageProps<"/[locale]/platform/standards/imports/[importId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.standards");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/platform/standards" className="text-primary text-sm hover:underline">
        {t("back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <Preview locale={locale as Locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Preview({
  locale,
  params,
  searchParams,
}: {
  locale: Locale;
  params: Promise<{ importId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "platform.standards" });
  const user = await requirePlatformAdmin(locale);
  const { importId } = await params;
  if (!z.uuid().safeParse(importId).success) notFound();
  const row = await getImport({ userId: user.id, isPlatformAdmin: user.isPlatformAdmin }, importId);
  if (!row) notFound();
  const { error } = await searchParams;
  const { report } = row;
  const counts = report.counts;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">
          {t("preview.heading", {
            name: localized(locale, report.framework.nameAr, report.framework.nameEn).text,
          })}
        </h1>
        <p className="text-muted-foreground text-sm">
          <bdi dir="ltr">
            {report.framework.code} {report.framework.edition}
          </bdi>{" "}
          · <bdi dir="ltr">{row.fileName}</bdi>
        </p>
      </div>

      {typeof error === "string" && (
        <Alert tone="danger">{t(`errors.${error as "invalid"}`)}</Alert>
      )}
      {row.status !== "validated" && <Alert>{t(`preview.${row.status}`)}</Alert>}

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("preview.contents")}</CardTitle>
        <dl className="grid grid-cols-2 gap-4 text-center sm:grid-cols-5">
          {(["chapters", "standards", "elements", "esr", "scaleLevels"] as const).map((key) => (
            <div key={key}>
              <dt className="text-muted-foreground text-xs">{t(`preview.counts.${key}`)}</dt>
              <dd className="text-xl font-semibold" data-testid={`count-${key}`}>
                {counts[key]}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>
          {report.diff.previousEdition
            ? t("diff.titleCompared", { edition: report.diff.previousEdition })
            : t("diff.titleFirst")}
        </CardTitle>
        <DiffSummary diff={report.diff} />
      </Card>

      {report.warnings.length > 0 && (
        <Card className="flex flex-col gap-4">
          <CardTitle className="flex items-center gap-2">
            {t("preview.warnings")} <Badge variant="warning">{report.warnings.length}</Badge>
          </CardTitle>
          <CardDescription>{t("preview.warningsHint")}</CardDescription>
          <IssueList issues={report.warnings} />
        </Card>
      )}

      {row.status === "validated" && (
        <div className="flex flex-wrap gap-3">
          <form action={commitImportAction}>
            <input type="hidden" name="importId" value={row.id} />
            <Button type="submit">{t("preview.commit")}</Button>
          </form>
          <form action={discardImportAction}>
            <input type="hidden" name="importId" value={row.id} />
            <Button type="submit" variant="outline">
              {t("preview.discard")}
            </Button>
          </form>
        </div>
      )}
      {row.status === "committed" && row.frameworkId && (
        <Link
          href={`/platform/standards/${row.frameworkId}`}
          className="text-primary hover:underline"
        >
          {t("preview.openEdition")}
        </Link>
      )}
    </>
  );
}
