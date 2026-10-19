import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import { getPreferences, listNotifications } from "@/modules/notifications/service";
import { PreferencesForm } from "@/modules/notifications/ui/PreferencesForm";
import { cn } from "@/lib/utils";
import { markAllReadAction, openNotificationAction, savePreferencesAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/notifications">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("notifications") };
}

export default async function NotificationsPage({ params }: PageProps<"/[locale]/notifications">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("notifications.inbox");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <Inbox locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function Inbox({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "notifications" });
  const ctx = await requireAppContext(locale);
  const [items, prefs] = await Promise.all([
    listNotifications(ctx.access, locale),
    getPreferences(ctx.access),
  ]);
  const unread = items.some((item) => !item.readAt);
  return (
    <>
      <section aria-labelledby="inbox-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="inbox-heading" className="text-lg font-semibold">
            {t("inbox.title")}
          </h2>
          {unread && (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                {t("inbox.markAllRead")}
              </Button>
            </form>
          )}
        </div>
        {items.length === 0 ? (
          <Card>
            <CardDescription>{t("inbox.empty")}</CardDescription>
          </Card>
        ) : (
          <Card className="p-0">
            <ul data-testid="inbox">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-type={item.type}
                  data-read={item.readAt ? "true" : "false"}
                  className={cn(
                    "border-border flex flex-wrap items-start justify-between gap-3 border-t px-5 py-4 first:border-t-0",
                    !item.readAt && "bg-primary/5",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {!item.readAt && <Badge variant="warning">{t("inbox.unread")}</Badge>}
                      <span dir="auto">{item.title}</span>
                    </span>
                    <span className="text-sm" dir="auto">
                      {item.body}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(item.createdAt, locale)}
                    </span>
                  </span>
                  <form action={openNotificationAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {t("inbox.open")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("prefs.title")}</CardTitle>
        <PreferencesForm initial={prefs} action={savePreferencesAction} />
      </Card>
    </>
  );
}
