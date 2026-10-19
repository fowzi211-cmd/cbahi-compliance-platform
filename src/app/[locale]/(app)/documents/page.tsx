import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { getUploadOptions, listDocuments } from "@/modules/documents/service";
import { UploadForm } from "@/modules/documents/ui/UploadForm";
import { VersionStateBadge } from "@/modules/documents/ui/VersionStateBadge";
import { localized } from "@/modules/standards/service";
import { createDocumentAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/documents">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("documents") };
}

export default async function DocumentsPage({ params }: PageProps<"/[locale]/documents">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("documents.list");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <DocumentsBody locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function DocumentsBody({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "documents" });
  const ctx = await requireAppContext(locale);
  const [options, documents] = await Promise.all([
    getUploadOptions(ctx.access, ctx.facilityId),
    listDocuments(ctx.access, ctx.facilityId),
  ]);
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const scopes = options
    ? [
        ...(options.wholeFacility ? [{ value: "", label: t("list.wholeFacility") }] : []),
        ...options.departments.map((d) => ({ value: d.id, label: name(d.nameAr, d.nameEn) })),
      ]
    : [];

  return (
    <>
      {scopes.length > 0 && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("list.newTitle")}</CardTitle>
          <UploadForm mode="document" scopes={scopes} action={createDocumentAction} />
        </Card>
      )}
      <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
        <h2 id="documents-heading" className="text-lg font-semibold">
          {t("list.heading")}
        </h2>
        {documents.length === 0 ? (
          <Card>
            <CardDescription>{t("list.empty")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="document-list">
              {documents.map((d) => (
                <li
                  key={d.id}
                  data-document={d.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium" dir="auto">
                      {name(d.titleAr, d.titleEn)}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                      <Badge>{t(`types.${d.type}`)}</Badge>
                      <VersionStateBadge
                        state={d.retiredAt ? "retired" : (d.current?.state ?? "none")}
                      />
                      {d.current && (
                        <span>{t("list.currentVersion", { version: d.current.version })}</span>
                      )}
                      {d.pendingVersion !== null && (
                        <span>{t("list.pendingVersion", { version: d.pendingVersion })}</span>
                      )}
                      <span>
                        {d.department
                          ? name(d.department.nameAr, d.department.nameEn)
                          : t("list.wholeFacility")}
                      </span>
                      <span>{t("list.linked", { count: d.linkedElements })}</span>
                    </span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/documents/${d.id}`}>{t("list.open")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
