import { createTranslator } from "next-intl";
import { formatDate, type AppLocale } from "@/lib/dates";
import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import { linkOf, payloadSchemas, type NotificationType } from "./domain/notifications";

// One renderer for the inbox, the bell and email, in the app and in the worker (which has no
// request, so it cannot use getTranslations).

const catalogues = { ar, en } as const;

export function translatorFor(locale: AppLocale) {
  return createTranslator({ locale, messages: catalogues[locale], namespace: "notifications" });
}

const isType = (type: string): type is NotificationType => type in payloadSchemas;

const day = (value: string, locale: AppLocale) =>
  formatDate(new Date(`${value}T12:00:00Z`), locale, { style: "medium" });

// A title in the reader's language, or the other one when it is missing.
const title = (locale: AppLocale, ar: string | null, en: string | null) =>
  (locale === "ar" ? ar || en : en || ar) ?? "";

export type RenderedNotification = { title: string; body: string; href: string };

/** The words of a notice, or null for a type this build does not know (shown as nothing). */
export function renderNotification(
  locale: AppLocale,
  notice: { type: string; payload: unknown },
): RenderedNotification | null {
  if (!isType(notice.type)) return null;
  const t = translatorFor(locale);
  const href = (payload: Record<string, unknown>) =>
    linkOf(notice.type as NotificationType, payload);
  switch (notice.type) {
    case "capaAssigned":
    case "capaOverdue": {
      const parsed = payloadSchemas[notice.type].safeParse(notice.payload);
      if (!parsed.success) return null;
      const p = parsed.data;
      const values = {
        code: p.elementCode,
        action: p.action,
        due: day(p.dueOn, locale),
        level: "level" in p ? String(p.level) : "1",
      };
      return {
        title: t(`types.${notice.type}.title`, values),
        body: t(`types.${notice.type}.body`, values),
        href: href(p),
      };
    }
    case "documentReviewDue":
    case "documentExpiring":
    case "documentExpired": {
      const parsed = payloadSchemas[notice.type].safeParse(notice.payload);
      if (!parsed.success) return null;
      const p = parsed.data;
      const values = {
        document: title(locale, p.titleAr, p.titleEn),
        version: p.version,
        date: day("reviewOn" in p ? p.reviewOn : p.expiresOn, locale),
      };
      return {
        title: t(`types.${notice.type}.title`, values),
        body: t(`types.${notice.type}.body`, values),
        href: href(p),
      };
    }
  }
}
