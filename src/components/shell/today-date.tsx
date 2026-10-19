"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { formatGregorian, formatHijri } from "@/lib/dates";
import type { Locale } from "@/i18n/routing";

const noopSubscribe = () => () => {};
// Read once per page load; the date in the header does not need to tick.
const pageLoadedAt = typeof window === "undefined" ? null : new Date();

// Rendered only on the client so the page itself stays static and cacheable.
export function TodayDate() {
  const t = useTranslations("shell");
  const locale = useLocale() as Locale;
  const now = useSyncExternalStore(
    noopSubscribe,
    () => pageLoadedAt,
    () => null,
  );

  if (!now) return <span className="hidden sm:inline" aria-hidden />;

  return (
    <p className="text-muted-foreground hidden text-sm sm:block">
      <span className="sr-only">{t("today")}: </span>
      <time dateTime={now.toISOString()}>{formatGregorian(now, locale, "full")}</time>
      <span aria-hidden> · </span>
      <span>{formatHijri(now, locale, "long")}</span>
    </p>
  );
}
