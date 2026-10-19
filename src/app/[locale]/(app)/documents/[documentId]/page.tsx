import { Download } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatDateTime } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { getDocument } from "@/modules/documents/service";
import { DecisionForm } from "@/modules/documents/ui/DecisionForm";
import { LinkElementForm } from "@/modules/documents/ui/LinkElementForm";
import { SmallActionForm } from "@/modules/documents/ui/SmallActionForm";
import { UploadForm } from "@/modules/documents/ui/UploadForm";
import { VersionStateBadge } from "@/modules/documents/ui/VersionStateBadge";
import { listFacilityElements, localized } from "@/modules/standards/service";
import {
  decideVersionAction,
  retireDocumentAction,
  setElementLinkAction,
  uploadVersionAction,
} from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/documents/[documentId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("documents") };
}

export default async function DocumentPage({
  params,
}: PageProps<"/[locale]/documents/[documentId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("documents");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/documents" className="text-primary text-sm hover:underline">
        {t("detail.back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <DocumentBody locale={locale as Locale} params={params} />
      </Suspense>
    </div>
  );
}

const sizeInKb = (bytes: number) => Math.max(1, Math.round(bytes / 1024));

async function DocumentBody({
  locale,
  params,
}: {
  locale: Locale;
  params: Promise<{ documentId: string }>;
}) {
  const t = await getTranslations({ locale, namespace: "documents" });
  const ctx = await requireAppContext(locale);
  const { documentId } = await params;
  const document = await getDocument(ctx.access, documentId);
  if (!document || document.facilityId !== ctx.facilityId) notFound();
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const linkedIds = new Set(document.elements.map((e) => e.id));
  const elements = document.canUpload
    ? (await listFacilityElements(ctx.access, ctx.facilityId)).filter((e) => !linkedIds.has(e.id))
    : [];
  const day = (value: string | null) =>
    value ? formatDate(new Date(`${value}T12:00:00Z`), locale, { style: "medium" }) : null;
  const download = (versionId: string) =>
    getPathname({ href: `/documents/versions/${versionId}/download`, locale });

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl" dir="auto">
          {name(document.titleAr, document.titleEn)}
        </h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <Badge>{t(`types.${document.type}`)}</Badge>
          <span>
            {document.department
              ? name(document.department.nameAr, document.department.nameEn)
              : t("list.wholeFacility")}
          </span>
          {document.retiredAt && <VersionStateBadge state="retired" />}
        </p>
      </div>
      {document.retiredAt && <Alert tone="info">{t("detail.retiredNote")}</Alert>}

      <section aria-labelledby="versions-heading" className="flex flex-col gap-3">
        <h2 id="versions-heading" className="text-lg font-semibold">
          {t("detail.versions")}
        </h2>
        <ul className="flex flex-col gap-3" data-testid="version-list">
          {document.versions.map((v) => (
            <li key={v.id} data-version={v.version}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t("detail.version", { version: v.version })}</CardTitle>
                  <VersionStateBadge state={v.state} />
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground inline">{t("detail.file")}: </dt>
                    <dd className="inline">
                      <bdi dir="ltr">{v.fileName}</bdi> (
                      {t("detail.size", { kb: sizeInKb(v.bytes) })})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">{t("detail.uploadedAt")}: </dt>
                    <dd className="inline">{formatDateTime(v.uploadedAt, locale)}</dd>
                  </div>
                  {v.effectiveOn && (
                    <div>
                      <dt className="text-muted-foreground inline">{t("upload.effectiveOn")}: </dt>
                      <dd className="inline">{day(v.effectiveOn)}</dd>
                    </div>
                  )}
                  {v.reviewOn && (
                    <div>
                      <dt className="text-muted-foreground inline">{t("upload.reviewOn")}: </dt>
                      <dd className="inline">{day(v.reviewOn)}</dd>
                    </div>
                  )}
                  {v.expiresOn && (
                    <div>
                      <dt className="text-muted-foreground inline">{t("upload.expiresOn")}: </dt>
                      <dd className="inline">{day(v.expiresOn)}</dd>
                    </div>
                  )}
                </dl>
                {v.changeNote && (
                  <p className="text-sm" dir="auto">
                    {v.changeNote}
                  </p>
                )}
                {v.phiOverride && <p className="text-warning text-sm">{t("detail.phiOverride")}</p>}
                {v.approvals.map((a) => (
                  <p key={a.decidedAt.toISOString()} className="text-sm">
                    {t(`detail.decision.${a.decision}`, {
                      date: formatDateTime(a.decidedAt, locale),
                    })}
                    {a.comment && (
                      <>
                        {" "}
                        <span dir="auto">{a.comment}</span>
                      </>
                    )}
                  </p>
                ))}
                <div>
                  {/* A plain link: the route mints a five-minute URL when it is clicked. */}
                  <a
                    href={download(v.id)}
                    className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                    data-testid="download"
                  >
                    <Download className="size-4" aria-hidden />
                    {t("detail.download")}
                  </a>
                </div>
                {v.status === "in_review" && document.canApprove && (
                  <DecisionForm versionId={v.id} action={decideVersionAction} />
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {document.canUpload && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("detail.newVersion")}</CardTitle>
          <CardDescription>{t("detail.newVersionHint")}</CardDescription>
          <UploadForm mode="version" documentId={document.id} action={uploadVersionAction} />
        </Card>
      )}

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("links.title")}</CardTitle>
        <CardDescription>{t("links.hint")}</CardDescription>
        {document.elements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("links.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="linked-elements">
            {document.elements.map((e) => (
              <li
                key={e.id}
                data-element={e.code}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span>
                  <bdi dir="ltr" className="font-mono font-medium">
                    {e.code}
                  </bdi>{" "}
                  {name(e.titleAr, e.titleEn)}
                </span>
                {document.canUpload && (
                  <SmallActionForm
                    fields={{ documentId: document.id, elementId: e.id, linked: "false" }}
                    label={t("links.unlink")}
                    action={setElementLinkAction}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {document.canUpload && elements.length > 0 && (
          <LinkElementForm
            documentId={document.id}
            elements={elements.map((e) => ({
              value: e.id,
              label: `${e.code} · ${name(e.titleAr, e.titleEn)}`,
            }))}
            action={setElementLinkAction}
          />
        )}
      </Card>

      {document.canApprove && (
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("detail.retireTitle")}</CardTitle>
          <CardDescription>{t("detail.retireHint")}</CardDescription>
          <SmallActionForm
            fields={{ documentId: document.id }}
            label={t("detail.retire")}
            variant="outline"
            action={retireDocumentAction}
          />
        </Card>
      )}
    </>
  );
}
