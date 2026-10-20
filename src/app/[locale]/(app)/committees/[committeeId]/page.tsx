import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate, toRiyadhDay } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import {
  committeeFrequencies,
  committeeLimits,
  getCommittee,
  getCommitteeOptions,
  type CommitteeDetail,
} from "@/modules/committees/service";
import { MeetingDueBadge, MinutesBadge } from "@/modules/committees/ui/Badges";
import { CommitteeActionButton } from "@/modules/committees/ui/CommitteeActionButton";
import { CommitteeForm } from "@/modules/committees/ui/CommitteeForm";
import { MeetingForm } from "@/modules/committees/ui/MeetingForm";
import { MinutesForm } from "@/modules/committees/ui/MinutesForm";
import { OverseeElementForm } from "@/modules/committees/ui/OverseeElementForm";
import { localized } from "@/modules/standards/service";
import {
  archiveCommitteeAction,
  deleteMeetingAction,
  fileMinutesAction,
  recordMeetingAction,
  setCommitteeElementAction,
  updateCommitteeAction,
} from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/committees/[committeeId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("committees") };
}

export default async function CommitteePage({
  params,
}: PageProps<"/[locale]/committees/[committeeId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("committees");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/committees" className="text-primary text-sm hover:underline">
        {t("detail.back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <CommitteeBody locale={locale as Locale} params={params} />
      </Suspense>
    </div>
  );
}

const day = (value: string, locale: Locale) =>
  formatDate(new Date(`${value}T12:00:00Z`), locale, { style: "medium" });

/** The minutes title in each language, from the committee's name in that language. */
async function minutesTitles(committee: CommitteeDetail, heldOn: string) {
  const title = async (locale: Locale, name: string | null) => {
    if (!name) return "";
    const t = await getTranslations({ locale, namespace: "committees.minutes" });
    return t("defaultTitle", { committee: name, date: day(heldOn, locale) });
  };
  return {
    ar: await title("ar", committee.nameAr),
    en: await title("en", committee.nameEn),
  };
}

async function CommitteeBody({
  locale,
  params,
}: {
  locale: Locale;
  params: Promise<{ committeeId: string }>;
}) {
  const t = await getTranslations({ locale, namespace: "committees" });
  const ctx = await requireAppContext(locale);
  const { committeeId } = await params;
  const committee = await getCommittee(ctx.access, committeeId);
  if (!committee || committee.facilityId !== ctx.facilityId) notFound();
  const options = committee.canManage
    ? await getCommitteeOptions(ctx.access, committee.facilityId)
    : null;
  const name = (ar: string | null, en: string | null) => localized(locale, ar, en).text;
  const overseen = new Set(committee.elements.map((e) => e.id));
  const elementChoices = (options?.elements ?? []).filter((e) => !overseen.has(e.id));
  const titles = new Map(
    await Promise.all(
      committee.meetings
        .filter((m) => committee.canManage && !m.minutesDocumentId)
        .map(async (m) => [m.id, await minutesTitles(committee, m.heldOn)] as const),
    ),
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-bold sm:text-3xl" dir="auto">
            {name(committee.nameAr, committee.nameEn)}
          </h1>
          <MeetingDueBadge state={committee.dueState} />
        </div>
        <p
          className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm"
          data-testid="committee-summary"
        >
          <span>{t(`frequency.${committee.frequency}`)}</span>
          <span>
            {committee.chairName
              ? t("list.chair", { name: committee.chairName })
              : t("list.noChair")}
          </span>
          <span>{t(`due.${committee.dueState}`, { date: day(committee.dueOn, locale) })}</span>
        </p>
      </div>

      <section aria-labelledby="meetings-heading" className="flex flex-col gap-3">
        <h2 id="meetings-heading" className="text-lg font-semibold">
          {t("detail.meetings")}
        </h2>
        {committee.canManage && (
          <Card>
            <MeetingForm
              committeeId={committee.id}
              today={toRiyadhDay(new Date())}
              action={recordMeetingAction}
            />
          </Card>
        )}
        {committee.meetings.length === 0 ? (
          <Card>
            <CardDescription>{t("detail.noMeetings")}</CardDescription>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="meeting-list">
            {committee.meetings.map((m) => {
              const defaults = titles.get(m.id);
              return (
                <li key={m.id} data-meeting={m.heldOn}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>
                        {t("detail.meetingOn", { date: day(m.heldOn, locale) })}
                      </CardTitle>
                      <MinutesBadge status={m.minutes} />
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {m.minutesDocumentId ? (
                        <Link
                          href={`/documents/${m.minutesDocumentId}`}
                          className="text-primary text-sm hover:underline"
                        >
                          {t("detail.openMinutes")}
                        </Link>
                      ) : committee.canManage ? (
                        <CommitteeActionButton
                          fields={{ meetingId: m.id }}
                          label={t("detail.deleteMeeting")}
                          action={deleteMeetingAction}
                        />
                      ) : null}
                    </div>
                    {defaults && (
                      <details className="group">
                        <summary className="text-primary cursor-pointer text-sm font-medium">
                          {t("minutes.title")}
                        </summary>
                        <div className="mt-3 flex flex-col gap-3">
                          <p className="text-muted-foreground text-sm">
                            {t("minutes.hint", { count: committee.elements.length })}
                          </p>
                          <MinutesForm
                            meetingId={m.id}
                            defaultTitles={defaults}
                            action={fileMinutesAction}
                          />
                        </div>
                      </details>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("detail.elementsTitle")}</CardTitle>
        <CardDescription>{t("detail.elementsHint")}</CardDescription>
        {committee.elements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("detail.noElements")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="overseen-elements">
            {committee.elements.map((e) => (
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
                {committee.canManage && (
                  <CommitteeActionButton
                    fields={{ committeeId: committee.id, elementId: e.id, linked: "false" }}
                    label={t("detail.removeElement")}
                    action={setCommitteeElementAction}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {committee.canManage && elementChoices.length > 0 && (
          <OverseeElementForm
            committeeId={committee.id}
            elements={elementChoices.map((e) => ({
              value: e.id,
              label: `${e.code} · ${name(e.titleAr, e.titleEn)}`,
            }))}
            action={setCommitteeElementAction}
          />
        )}
      </Card>

      {options && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{t("detail.settingsTitle")}</CardTitle>
          <CommitteeForm
            committeeId={committee.id}
            initial={{
              nameAr: committee.nameAr ?? "",
              nameEn: committee.nameEn ?? "",
              frequency: committee.frequency,
              chairUserId: committee.chairUserId ?? "",
            }}
            frequencies={committeeFrequencies.map((f) => ({
              value: f,
              label: t(`frequency.${f}`),
            }))}
            people={options.people.map((p) => ({ value: p.userId, label: p.name }))}
            nameLimit={committeeLimits.name}
            action={updateCommitteeAction}
          />
        </Card>
      )}

      {committee.canManage && (
        <Card className="flex flex-col gap-3">
          <CardTitle>{t("detail.archiveTitle")}</CardTitle>
          <CardDescription>{t("detail.archiveHint")}</CardDescription>
          <CommitteeActionButton
            fields={{ committeeId: committee.id }}
            label={t("detail.archive")}
            variant="outline"
            action={archiveCommitteeAction}
          />
        </Card>
      )}
    </>
  );
}
