import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import {
  committeeFrequencies,
  committeeLimits,
  getCommitteeOptions,
  listCommittees,
} from "@/modules/committees/service";
import { MeetingDueBadge } from "@/modules/committees/ui/Badges";
import { CommitteeForm } from "@/modules/committees/ui/CommitteeForm";
import { localized } from "@/modules/standards/service";
import { createCommitteeAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/committees">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("committees") };
}

export default async function CommitteesPage({ params }: PageProps<"/[locale]/committees">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("committees.list");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <CommitteesBody locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function CommitteesBody({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "committees" });
  const ctx = await requireAppContext(locale);
  const [{ committees }, options] = await Promise.all([
    listCommittees(ctx.access, ctx.facilityId),
    getCommitteeOptions(ctx.access, ctx.facilityId),
  ]);
  const date = (value: string) =>
    formatDate(new Date(`${value}T12:00:00Z`), locale, { style: "medium" });

  return (
    <>
      {committees.length === 0 ? (
        <Card>
          <CardDescription>{t("list.empty")}</CardDescription>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="committee-list">
          {committees.map((c) => (
            <li key={c.id} data-committee={c.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-lg font-semibold" dir="auto">
                      {localized(locale, c.nameAr, c.nameEn).text}
                    </h2>
                    <CardDescription>
                      {t(`frequency.${c.frequency}`)}
                      {" · "}
                      {c.chairName ? t("list.chair", { name: c.chairName }) : t("list.noChair")}
                      {" · "}
                      {t("list.elements", { count: c.elementCount })}
                    </CardDescription>
                  </div>
                  <MeetingDueBadge state={c.dueState} />
                </div>
                <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>{t(`due.${c.dueState}`, { date: date(c.dueOn) })}</span>
                  <span>
                    {c.lastHeldOn
                      ? t("list.lastMet", { date: date(c.lastHeldOn) })
                      : t("list.neverMet")}
                  </span>
                  {c.minutesMissing > 0 && (
                    <span className="text-warning">
                      {t("list.minutesMissing", { count: c.minutesMissing })}
                    </span>
                  )}
                </p>
                <div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/committees/${c.id}`}>{t("list.open")}</Link>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {options && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("list.newTitle")}</CardTitle>
            <CardDescription>{t("list.newIntro")}</CardDescription>
          </div>
          <CommitteeForm
            frequencies={committeeFrequencies.map((f) => ({
              value: f,
              label: t(`frequency.${f}`),
            }))}
            people={options.people.map((p) => ({ value: p.userId, label: p.name }))}
            nameLimit={committeeLimits.name}
            action={createCommitteeAction}
          />
        </Card>
      )}
    </>
  );
}
