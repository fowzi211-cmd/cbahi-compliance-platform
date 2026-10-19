"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("shell");
  const locale = useLocale();
  const pathname = usePathname();
  const other: Locale = locale === "ar" ? "en" : "ar";

  return (
    <Link
      href={pathname}
      locale={other}
      lang={other}
      hrefLang={other}
      title={t("switchLocaleLabel")}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <Languages aria-hidden />
      {t("switchLocale")}
    </Link>
  );
}
