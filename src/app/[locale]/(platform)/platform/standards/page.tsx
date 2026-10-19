import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requirePlatformAdmin } from "@/lib/session";
import { listEditions, listPendingImports, localized } from "@/modules/standards/service";
import { ImportForm } from "@/modules/standards/ui/ImportForm";
import { StatusBadge } from "@/modules/standards/ui/StatusBadge";
import { previewImportAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/standards">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "platform.standards" });
  return { title: t("title") };
}

export default async function PlatformStandardsPage({
  params,
}: PageProps<"/[locale]/platform/standards">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.standards");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("upload.title")}</CardTitle>
        <ImportForm action={previewImportAction} />
      </Card>
      <Suspense fallback={<Pending />}>
        <Lists locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function Lists({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "platform.standards" });
  const user = await requirePlatformAdmin(locale);
  const actor = { userId: user.id, isPlatformAdmin: user.isPlatformAdmin };
  const [pending, editions] = await Promise.all([listPendingImports(actor), listEditions(actor)]);

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("pending.title")}</CardTitle>
        {pending.length === 0 ? (
          <CardDescription>{t("pending.empty")}</CardDescription>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((p) => (
              <li
                key={p.id}
                className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    <bdi dir="ltr">
                      {p.report.framework.code} {p.report.framework.edition}
                    </bdi>
                  </span>
                  <span className="text-muted-foreground text-sm">
                    <bdi dir="ltr">{p.fileName}</bdi> · {formatDate(p.createdAt, locale)}
                  </span>
                </div>
                <Link
                  href={`/platform/standards/imports/${p.id}`}
                  className="text-primary text-sm hover:underline"
                >
                  {t("pending.open")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("editions.title")}</CardTitle>
        {editions.length === 0 ? (
          <CardDescription>{t("editions.empty")}</CardDescription>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t("editions.framework")}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t("editions.edition")}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t("editions.status")}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t("editions.elements")}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t("editions.esr")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {editions.map((e) => (
                  <tr key={e.id} className="border-border border-t">
                    <td className="py-2 pe-3">
                      <Link
                        href={`/platform/standards/${e.id}`}
                        className="text-primary hover:underline"
                      >
                        <bdi dir="ltr">{e.code}</bdi>
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {localized(locale, e.nameAr, e.nameEn).text}
                      </span>
                    </td>
                    <td className="py-2 pe-3">
                      <bdi dir="ltr">{e.edition}</bdi>
                    </td>
                    <td className="py-2 pe-3">
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="py-2 pe-3">{e._count.elements}</td>
                    <td className="py-2">
                      {e.esrCount > 0 ? <Badge variant="danger">{e.esrCount}</Badge> : e.esrCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
