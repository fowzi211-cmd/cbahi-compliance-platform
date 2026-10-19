import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Label, Select } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import {
  findingSeverities,
  findingStatuses,
  listFindings,
  listMyCapaItems,
  type FindingSeverity,
  type FindingStatus,
} from "@/modules/findings/service";
import { EscalationBadge, FindingStatusBadge, SeverityBadge } from "@/modules/findings/ui/Badges";
import { localized } from "@/modules/standards/service";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/findings">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("findings") };
}

export default async function FindingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/findings">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("findings.list");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <FindingsBody locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const pick = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((v) => v === value);

const day = (value: string, locale: Locale) =>
  formatDate(new Date(`${value}T12:00:00Z`), locale, { style: "medium" });

async function FindingsBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "findings" });
  const ctx = await requireAppContext(locale);
  const query = await searchParams;
  const status = pick<FindingStatus>(findingStatuses, query.status);
  const severity = pick<FindingSeverity>(findingSeverities, query.severity);
  const [findings, mine] = await Promise.all([
    listFindings(ctx.access, ctx.facilityId, { status, severity }),
    listMyCapaItems(ctx.access, ctx.facilityId),
  ]);
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;

  return (
    <>
      <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
        <h2 id="mine-heading" className="text-lg font-semibold">
          {t("list.mine")}
        </h2>
        {mine.length === 0 ? (
          <Card>
            <CardDescription>{t("list.mineEmpty")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="my-capa">
              {mine.map((item) => (
                <li
                  key={item.id}
                  data-capa={item.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium" dir="auto">
                      {item.action}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                      <bdi dir="ltr" className="font-mono">
                        {item.finding.element.code}
                      </bdi>
                      <span>{t("capa.dueLabel", { date: day(item.dueOn, locale) })}</span>
                      <EscalationBadge level={item.escalation} />
                    </span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/findings/${item.finding.id}`}>{t("list.open")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="findings-heading" className="flex flex-col gap-3">
        <h2 id="findings-heading" className="text-lg font-semibold">
          {t("list.heading")}
        </h2>
        <form
          method="get"
          action={getPathname({ href: "/findings", locale })}
          className="flex flex-wrap items-end gap-3"
          data-testid="finding-filter"
        >
          <Field>
            <Label htmlFor="filter-status">{t("list.filterStatus")}</Label>
            <Select id="filter-status" name="status" defaultValue={status ?? ""}>
              <option value="">{t("list.all")}</option>
              {findingStatuses.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="filter-severity">{t("list.filterSeverity")}</Label>
            <Select id="filter-severity" name="severity" defaultValue={severity ?? ""}>
              <option value="">{t("list.all")}</option>
              {findingSeverities.map((s) => (
                <option key={s} value={s}>
                  {t(`severity.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="outline">
            {t("list.apply")}
          </Button>
        </form>
        {findings.length === 0 ? (
          <Card>
            <CardTitle className="text-base">{t("list.emptyTitle")}</CardTitle>
            <CardDescription>{t("list.empty")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="finding-list">
              {findings.map((f) => (
                <li
                  key={f.id}
                  data-finding={f.element.code}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <bdi dir="ltr" className="font-mono font-medium">
                        {f.element.code}
                      </bdi>
                      <SeverityBadge severity={f.severity} />
                      <FindingStatusBadge status={f.status} />
                    </span>
                    <span className="text-sm">{name(f.element.titleAr, f.element.titleEn)}</span>
                    <span className="text-muted-foreground flex flex-wrap gap-3 text-sm">
                      <span>
                        {f.capa.total === 0
                          ? t("list.noActions")
                          : t("list.actions", { done: f.capa.done, total: f.capa.total })}
                      </span>
                      {f.capa.overdue > 0 && (
                        <span className="text-danger">
                          {t("list.overdue", { count: f.capa.overdue })}
                        </span>
                      )}
                    </span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/findings/${f.id}`}>{t("list.open")}</Link>
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
