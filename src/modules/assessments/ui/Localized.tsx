import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/modules/standards/service";

/** Library text in the reader's language, or the other one marked as a missing translation. */
export async function Localized({
  locale,
  ar,
  en,
}: {
  locale: Locale;
  ar: string | null;
  en: string | null;
}) {
  const value = localized(locale, ar, en);
  if (!value.missing) return <>{value.text}</>;
  const t = await getTranslations({ locale, namespace: "standards" });
  return (
    <>
      <span lang={value.lang} dir="auto">
        {value.text}
      </span>{" "}
      <Badge>{t("translationMissing")}</Badge>
    </>
  );
}
