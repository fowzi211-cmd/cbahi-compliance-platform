import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Label, Select } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import {
  canViewAuditLog,
  getAuditChainStatus,
  getAuditLog,
  type AuditLogEntry,
  type AuditQuery,
} from "@/modules/governance/service";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/audit">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("auditLog") };
}

// The organization's audit log (ARCHITECTURE §6): read-only, newest first, filtered through
// the URL so a filtered view can be bookmarked or shared with a surveyor.
export default async function AuditPage({ params, searchParams }: PageProps<"/[locale]/audit">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("audit");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <AuditBody locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

async function AuditBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "audit" });
  const ctx = await requireAppContext(locale);
  if (!(await canViewAuditLog(ctx.access))) {
    return <Alert tone="info">{t("forbidden")}</Alert>;
  }
  const raw = await searchParams;
  const query: AuditQuery = {
    action: first(raw.action),
    entity: first(raw.entity),
    actor: first(raw.actor),
    from: first(raw.from),
    to: first(raw.to),
    before: first(raw.before),
  };
  const log = await getAuditLog(ctx.access, query);
  // Codes come from the log itself, so one without a translation is shown as stored.
  type Key = Parameters<typeof t>[0];
  const label = (key: string, code: string) => (t.has(key as Key) ? t(key as Key) : code);
  const actionLabel = (code: string) => label(`actions.${code}`, code);
  const entityLabel = (code: string) => label(`entities.${code}`, code);
  const path = getPathname({ href: "/audit", locale });
  const filters = { ...log.query, before: undefined };
  const olderHref = log.olderBefore
    ? `/audit?${new URLSearchParams({ ...stringify(filters), before: String(log.olderBefore) })}`
    : null;

  return (
    <>
      <Suspense fallback={<Pending />}>
        <ChainStatus locale={locale} />
      </Suspense>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("filters.title")}</CardTitle>
        <form
          method="get"
          action={path}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="audit-filter"
        >
          <Field>
            <Label htmlFor="audit-action">{t("filters.action")}</Label>
            <Select id="audit-action" name="action" defaultValue={log.query.action ?? ""}>
              <option value="">{t("filters.any")}</option>
              {log.facets.actions.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="audit-entity">{t("filters.entity")}</Label>
            <Select id="audit-entity" name="entity" defaultValue={log.query.entity ?? ""}>
              <option value="">{t("filters.any")}</option>
              {log.facets.entities.map((e) => (
                <option key={e} value={e}>
                  {entityLabel(e)}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
            <Select id="audit-actor" name="actor" defaultValue={log.query.actor ?? ""}>
              <option value="">{t("filters.any")}</option>
              {log.facets.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="audit-from">{t("filters.from")}</Label>
            <Input id="audit-from" name="from" type="date" defaultValue={log.query.from ?? ""} />
          </Field>
          <Field>
            <Label htmlFor="audit-to">{t("filters.to")}</Label>
            <Input id="audit-to" name="to" type="date" defaultValue={log.query.to ?? ""} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
            <Button asChild variant="ghost">
              <Link href="/audit">{t("filters.clear")}</Link>
            </Button>
          </div>
        </form>
      </Card>

      {log.entries.length === 0 ? (
        <Card>
          <CardDescription>{t("empty")}</CardDescription>
        </Card>
      ) : (
        <Card className="p-0">
          <ol data-testid="audit-list">
            {log.entries.map((entry) => (
              <Entry
                key={entry.id}
                entry={entry}
                locale={locale}
                action={actionLabel(entry.action)}
                entity={entityLabel(entry.entity)}
                labels={{
                  actor:
                    entry.actor.kind === "person"
                      ? entry.actor.name
                      : t(`entry.${entry.actor.kind}`),
                  position: t("entry.position", { seq: entry.chainSeq }),
                  record: t("entry.record"),
                  details: t("entry.details"),
                  before: t("entry.before"),
                  after: t("entry.after"),
                }}
              />
            ))}
          </ol>
        </Card>
      )}

      {(olderHref || log.query.before) && (
        <nav className="flex flex-wrap justify-between gap-3">
          {log.query.before ? (
            <Button asChild variant="outline">
              <Link href={`/audit?${new URLSearchParams(stringify(filters))}`}>{t("newest")}</Link>
            </Button>
          ) : (
            <span />
          )}
          {olderHref && (
            <Button asChild variant="outline">
              <Link href={olderHref}>{t("older")}</Link>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}

function stringify(values: Record<string, string | number | undefined>) {
  return Object.fromEntries(
    Object.entries(values).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  );
}

function Entry({
  entry,
  locale,
  action,
  entity,
  labels,
}: {
  entry: AuditLogEntry;
  locale: Locale;
  action: string;
  entity: string;
  labels: Record<"actor" | "position" | "record" | "details" | "before" | "after", string>;
}) {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const hasDetails = entry.before != null || entry.after != null;
  return (
    <li
      data-seq={entry.chainSeq}
      className="border-border flex flex-col gap-2 border-t px-5 py-4 first:border-t-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {action} · {entity}
        </span>
        <span className="text-muted-foreground text-sm">
          <bdi>{labels.position}</bdi>
        </span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>{labels.actor}</span>
        <time dateTime={entry.at.toISOString()}>{formatDateTime(entry.at, locale)}</time>
        {entry.entityId && (
          <span>
            {labels.record}:{" "}
            <bdi dir="ltr" className="font-mono text-xs">
              {entry.entityId}
            </bdi>
          </span>
        )}
      </div>
      {hasDetails && (
        <details className="text-sm">
          <summary className="cursor-pointer">{labels.details}</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {(["before", "after"] as const).map((side) =>
              entry[side] == null ? null : (
                <div key={side} className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{labels[side]}</span>
                  <pre
                    dir="ltr"
                    className="bg-muted overflow-x-auto rounded-md p-3 text-start font-mono text-xs"
                  >
                    {json(entry[side])}
                  </pre>
                </div>
              ),
            )}
          </div>
        </details>
      )}
    </li>
  );
}

async function ChainStatus({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "audit.chain" });
  const ctx = await requireAppContext(locale);
  const chain = await getAuditChainStatus(ctx.access);
  return (
    <Alert tone={chain.ok ? "success" : "danger"} data-testid="audit-chain">
      <span className="font-medium">{t("title")}: </span>
      {chain.ok
        ? t("ok", { count: chain.checked })
        : t("broken", { seq: chain.firstBrokenSeq ?? 0 })}
    </Alert>
  );
}
