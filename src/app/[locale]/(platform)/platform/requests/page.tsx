import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { Field, Input, Label } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/dates";
import { requirePlatformAdmin } from "@/lib/session";
import { localized } from "@/modules/standards/service";
import {
  listRequestsForPlatform,
  requestLimits,
  type PlatformRequestRow,
} from "@/modules/subscriptions/service";
import { Feedback, RequestStatusBadge } from "@/modules/subscriptions/ui/Badges";
import { requestAction } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/requests">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "platform.requests" });
  return { title: t("title") };
}

export default async function PlatformRequestsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/platform/requests">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.requests");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <Requests locale={locale as Locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Requests({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "platform.requests" });
  const ts = await getTranslations({ locale, namespace: "subscriptions" });
  const user = await requirePlatformAdmin(locale);
  const query = await searchParams;
  const scope = query.scope === "closed" ? "closed" : "active";
  const rows = await listRequestsForPlatform({ userId: user.id, isPlatformAdmin: true }, scope);

  const actions = (row: PlatformRequestRow) =>
    row.status === "open"
      ? (["start", "cancel"] as const)
      : row.status === "in_progress"
        ? (["complete", "cancel"] as const)
        : ([] as const);

  return (
    <>
      <Feedback locale={locale} query={query} />
      <nav className="flex gap-4 text-sm" aria-label={t("scopeLabel")}>
        {(["active", "closed"] as const).map((s) => (
          <Link
            key={s}
            href={s === "active" ? "/platform/requests" : "/platform/requests?scope=closed"}
            aria-current={scope === s ? "page" : undefined}
            className={scope === s ? "font-semibold underline" : "text-primary hover:underline"}
          >
            {t(`scopes.${s}`)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card>
          <CardDescription>{t("empty")}</CardDescription>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="platform-requests">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold">
                      {row.kind ? ts(`kinds.${row.kind}`) : ts("kinds.unknown")}
                    </span>
                    <CardDescription>
                      <span dir="auto">{row.tenant.name}</span> ·{" "}
                      {localized(locale, row.facility.nameAr, row.facility.nameEn).text} ·{" "}
                      {formatDateTime(row.submittedAt ?? row.createdAt, locale)}
                    </CardDescription>
                    {row.origin === "struggle_signal" && (
                      <div className="text-muted-foreground text-sm">
                        {t("fromSignal")}
                        <ul className="list-disc ps-5">
                          {row.signalReasons.map((r) => (
                            <li key={r}>{ts(`reasons.${r as "esrNotMet"}`)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <RequestStatusBadge locale={locale} status={row.status} />
                </div>
                {row.note && (
                  <p className="text-sm whitespace-pre-line" dir="auto">
                    {row.note}
                  </p>
                )}
                {row.platformNote && (
                  <p className="text-muted-foreground text-sm" dir="auto">
                    {t("teamNote", { note: row.platformNote })}
                  </p>
                )}
                {actions(row).length > 0 && (
                  <form action={requestAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="requestId" value={row.id} />
                    <Field className="min-w-0 flex-1">
                      <Label htmlFor={`note-${row.id}`}>{t("note")}</Label>
                      <Input
                        id={`note-${row.id}`}
                        name="platformNote"
                        maxLength={requestLimits.note}
                        dir="auto"
                      />
                    </Field>
                    {actions(row).map((action) => (
                      <Button
                        key={action}
                        type="submit"
                        name="action"
                        value={action}
                        variant={action === "cancel" ? "outline" : "default"}
                      >
                        {t(`actions.${action}`)}
                      </Button>
                    ))}
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
