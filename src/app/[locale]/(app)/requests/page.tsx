import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, Label, Select, Textarea } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import {
  listServiceRequests,
  requestKinds,
  requestLimits,
  type ServiceRequestRow,
} from "@/modules/subscriptions/service";
import { Feedback, RequestStatusBadge } from "@/modules/subscriptions/ui/Badges";
import { answerRequestAction, createRequestAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/requests">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("requests") };
}

export default async function RequestsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/requests">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("requests");
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
  const t = await getTranslations({ locale, namespace: "requests" });
  const ts = await getTranslations({ locale, namespace: "subscriptions" });
  const ctx = await requireAppContext(locale);
  const requests = await listServiceRequests(ctx.access, ctx.facilityId);
  if (!requests) {
    return (
      <Card>
        <CardDescription>{t("noAccess")}</CardDescription>
      </Card>
    );
  }

  const kindSelect = (id: string, required: boolean) => (
    <Select id={id} name="kind" required={required} defaultValue="">
      <option value="" disabled>
        {t("chooseKind")}
      </option>
      {requestKinds.map((k) => (
        <option key={k} value={k}>
          {ts(`kinds.${k}`)}
        </option>
      ))}
    </Select>
  );

  const item = (r: ServiceRequestRow) => (
    <li key={r.id} data-request={r.id}>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold">
              {r.kind ? ts(`kinds.${r.kind}`) : t("offerTitle")}
            </span>
            <CardDescription>
              {formatDateTime(r.submittedAt ?? r.createdAt, locale)}
            </CardDescription>
          </div>
          <RequestStatusBadge locale={locale} status={r.status} />
        </div>
        {r.origin === "struggle_signal" && (
          <div className="flex flex-col gap-1 text-sm">
            <p>{t("offerWhy")}</p>
            <ul className="list-disc ps-5">
              {r.signalReasons.map((reason) => (
                <li key={reason}>{ts(`reasons.${reason as "esrNotMet"}`)}</li>
              ))}
            </ul>
          </div>
        )}
        {r.note && (
          <p className="text-sm whitespace-pre-line" dir="auto">
            {r.note}
          </p>
        )}
        {r.platformNote && (
          <p className="text-muted-foreground text-sm" dir="auto">
            {t("teamNote", { note: r.platformNote })}
          </p>
        )}
        {r.status === "offered" && (
          <form action={answerRequestAction} className="flex flex-col gap-3">
            <input type="hidden" name="requestId" value={r.id} />
            <Field>
              <Label htmlFor={`kind-${r.id}`}>{t("kind")}</Label>
              {kindSelect(`kind-${r.id}`, false)}
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" name="action" value="accept">
                {t("accept")}
              </Button>
              <Button type="submit" name="action" value="dismiss" variant="outline" formNoValidate>
                {t("dismiss")}
              </Button>
            </div>
          </form>
        )}
        {r.status === "open" && (
          <form action={answerRequestAction}>
            <input type="hidden" name="requestId" value={r.id} />
            <Button type="submit" name="action" value="cancel" variant="outline" size="sm">
              {t("cancel")}
            </Button>
          </form>
        )}
      </Card>
    </li>
  );

  return (
    <>
      <Feedback locale={locale} query={await searchParams} />
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("new")}</CardTitle>
        <form
          action={createRequestAction}
          className="flex flex-col gap-4"
          data-testid="request-new"
        >
          <Field>
            <Label htmlFor="request-kind">{t("kind")}</Label>
            {kindSelect("request-kind", true)}
          </Field>
          <Field>
            <Label htmlFor="request-note">{t("note")}</Label>
            <Textarea
              id="request-note"
              name="note"
              maxLength={requestLimits.note}
              dir="auto"
              aria-describedby="request-note-hint"
            />
            <FieldHint id="request-note-hint">{t("noteHint")}</FieldHint>
          </Field>
          <div>
            <Button type="submit">{t("send")}</Button>
          </div>
        </form>
      </Card>
      {requests.length === 0 ? (
        <Card>
          <CardDescription>{t("empty")}</CardDescription>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="request-list">
          {requests.map(item)}
        </ul>
      )}
    </>
  );
}
