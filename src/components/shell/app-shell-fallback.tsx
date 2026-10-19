"use client";

import { useTranslations } from "next-intl";

/** Shown while the session is checked; same frame, so the page does not jump. */
export function AppShellFallback() {
  const t = useTranslations("common");
  return (
    <div className="flex min-h-dvh flex-col" aria-busy="true">
      <header className="border-border flex h-16 items-center gap-3 border-b px-4">
        <span className="text-primary text-xl font-bold">{t("appName")}</span>
      </header>
    </div>
  );
}
