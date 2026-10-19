"use client";

import { useTranslations } from "next-intl";

/** Suspense fallback for the request-dependent part of a page. */
export function Pending() {
  const t = useTranslations("common");
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {t("loading")}
    </p>
  );
}
