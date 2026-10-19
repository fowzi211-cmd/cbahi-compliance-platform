import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatDateTime, toRiyadhDay } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { listCitableVersions } from "@/modules/documents/service";
import {
  capaTransitions,
  getFinding,
  listCapaOwners,
  type CapaItemView,
} from "@/modules/findings/service";
import { ActionButton } from "@/modules/findings/ui/ActionButton";
import {
  CapaStatusBadge,
  EscalationBadge,
  FindingStatusBadge,
  SeverityBadge,
} from "@/modules/findings/ui/Badges";
import { CapaForm } from "@/modules/findings/ui/CapaForm";
import { EvidenceForm } from "@/modules/findings/ui/EvidenceForm";
import { RescheduleForm } from "@/modules/findings/ui/RescheduleForm";
import { TransitionForm } from "@/modules/findings/ui/TransitionForm";
import { localized } from "@/modules/standards/service";
import {
  addEvidenceAction,
  createCapaAction,
  removeEvidenceAction,
  rescheduleCapaAction,
  transitionCapaAction,
} from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/findings/[findingId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("findings") };
}

export default async function FindingPage({ params }: PageProps<"/[locale]/findings/[findingId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("findings");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/findings" className="text-primary text-sm hover:underline">
        {t("detail.back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <FindingBody locale={locale as Locale} params={params} />
      </Suspense>
    </div>
  );
}

async function FindingBody({
  locale,
  params,
}: {
  locale: Locale;
  params: Promise<{ findingId: string }>;
}) {
  const t = await getTranslations({ locale, namespace: "findings" });
  const ctx = await requireAppContext(locale);
  const { findingId } = await params;
  const finding = await getFinding(ctx.access, findingId);
  if (!finding || finding.facilityId !== ctx.facilityId) notFound();
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const needsEvidenceOptions = finding.capaItems.some((item) => item.canEditEvidence);
  const [owners, documents] = await Promise.all([
    finding.canPlan ? listCapaOwners(ctx.access, ctx.facilityId) : [],
    needsEvidenceOptions ? listCitableVersions(ctx.access, ctx.facilityId) : [],
  ]);
  // Documents linked to the finding's element first: they are the likely proof.
  const documentOptions = [...documents]
    .sort(
      (a, b) =>
        Number(b.elementIds.includes(finding.element.id)) -
        Number(a.elementIds.includes(finding.element.id)),
    )
    .map((d) => ({
      value: d.versionId,
      label: t("capa.documentOption", {
        title: name(d.titleAr, d.titleEn),
        version: d.version,
      }),
    }));
  const today = toRiyadhDay(new Date());

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-2">
          <bdi dir="ltr" className="font-mono text-lg font-semibold">
            {finding.element.code}
          </bdi>
          <SeverityBadge severity={finding.severity} />
          <FindingStatusBadge status={finding.status} />
        </p>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {name(finding.element.titleAr, finding.element.titleEn)}
        </h1>
        <p className="text-muted-foreground flex flex-wrap gap-3 text-sm">
          <span>{t("detail.raised", { date: formatDateTime(finding.createdAt, locale) })}</span>
          <Link
            href={`/assessments/${finding.assessmentId}`}
            className="text-primary hover:underline"
          >
            {t("detail.assessment")}
          </Link>
        </p>
      </div>

      {finding.statement && (
        <Card className="flex flex-col gap-2">
          <CardTitle className="text-base">{t("detail.statement")}</CardTitle>
          <p dir="auto">{finding.statement}</p>
        </Card>
      )}

      {finding.status === "closed" && <Alert tone="info">{t("detail.closedNote")}</Alert>}
      {finding.status === "verified" && finding.verifiedAt && finding.verifiedScore && (
        <Alert tone="success" data-testid="finding-verified">
          {t("detail.verifiedNote", { date: formatDateTime(finding.verifiedAt, locale) })}{" "}
          <Link href={`/assessments/${finding.verifiedScore.assessmentId}`} className="underline">
            {t("detail.verifiedBy")}
          </Link>
        </Alert>
      )}

      <section aria-labelledby="capa-heading" className="flex flex-col gap-3">
        <h2 id="capa-heading" className="text-lg font-semibold">
          {t("detail.actions")}
        </h2>
        {finding.capaItems.length === 0 ? (
          <Card>
            <CardDescription>{t("detail.noActions")}</CardDescription>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="capa-list">
            {finding.capaItems.map((item) => (
              <li key={item.id} data-capa={item.id}>
                <CapaItemCard
                  item={item}
                  locale={locale}
                  today={today}
                  documents={documentOptions}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {finding.canPlan && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("detail.newAction")}</CardTitle>
          <CardDescription>{t("detail.newActionHint")}</CardDescription>
          <CapaForm
            findingId={finding.id}
            owners={owners.map((o) => ({ value: o.userId, label: o.name }))}
            today={today}
            action={createCapaAction}
          />
        </Card>
      )}
    </>
  );
}

async function CapaItemCard({
  item,
  locale,
  today,
  documents,
}: {
  item: CapaItemView;
  locale: Locale;
  today: string;
  documents: { value: string; label: string }[];
}) {
  const t = await getTranslations({ locale, namespace: "findings" });
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const transitions = capaTransitions.filter((tr) => item.allowed[tr]);
  const download = (versionId: string) =>
    getPathname({ href: `/documents/versions/${versionId}/download`, locale });
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium" dir="auto">
          {item.action}
        </p>
        <span className="flex flex-wrap gap-2">
          <CapaStatusBadge status={item.status} />
          <EscalationBadge level={item.escalation} />
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground inline">{t("capa.owner")}: </dt>
          <dd className="inline" data-testid="capa-owner">
            {item.ownerName ?? t("capa.formerMember")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground inline">{t("capa.dueOn")}: </dt>
          <dd className="inline" data-testid="capa-due">
            {formatDate(new Date(`${item.dueOn}T12:00:00Z`), locale, { style: "medium" })}
          </dd>
        </div>
        {item.closedAt && (
          <div>
            <dt className="text-muted-foreground inline">{t("capa.closedAt")}: </dt>
            <dd className="inline">{formatDateTime(item.closedAt, locale)}</dd>
          </div>
        )}
      </dl>
      {item.status === "done" && item.closureNote && (
        <p className="text-sm" dir="auto" data-testid="capa-closure-note">
          {item.closureNote}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("capa.evidence")}</h3>
        {item.evidence.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("capa.noEvidence")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="capa-evidence">
            {item.evidence.map((e) => (
              <li
                key={e.id}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  {e.kind === "document" && e.documentVersion ? (
                    <a
                      href={download(e.documentVersion.id)}
                      className="text-primary hover:underline"
                    >
                      {t("capa.documentOption", {
                        title: name(
                          e.documentVersion.document.titleAr,
                          e.documentVersion.document.titleEn,
                        ),
                        version: e.documentVersion.version,
                      })}
                    </a>
                  ) : (
                    e.url && (
                      <a
                        href={e.url}
                        className="text-primary break-all hover:underline"
                        rel="noopener noreferrer"
                        target="_blank"
                        dir="ltr"
                      >
                        {e.url}
                      </a>
                    )
                  )}
                  {e.description && (
                    <span className="text-muted-foreground" dir="auto">
                      {e.description}
                    </span>
                  )}
                </span>
                {item.canEditEvidence && (
                  <ActionButton
                    fields={{ evidenceId: e.id }}
                    label={t("capa.remove")}
                    action={removeEvidenceAction}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {item.canEditEvidence && (
          <EvidenceForm itemId={item.id} documents={documents} action={addEvidenceAction} />
        )}
      </div>

      {transitions.length > 0 && (
        <TransitionForm itemId={item.id} transitions={transitions} action={transitionCapaAction} />
      )}
      {item.canReschedule && (
        <details className="text-sm">
          <summary className="text-primary cursor-pointer">{t("capa.reschedule")}</summary>
          <div className="pt-3">
            <RescheduleForm
              itemId={item.id}
              dueOn={item.dueOn}
              today={today}
              action={rescheduleCapaAction}
            />
          </div>
        </details>
      )}
    </Card>
  );
}
