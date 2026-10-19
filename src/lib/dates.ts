// The single place where dates are turned into text. Values are stored in UTC and shown in
// Saudi time. Gregorian is the default calendar; the Hijri (Umm al-Qura) date is an opt-in
// addition next to it, never a replacement, because survey dates are set in Gregorian.

export const TIME_ZONE = "Asia/Riyadh";

export type AppLocale = "ar" | "en";
export type DateStyle = "short" | "medium" | "long" | "full";

// Latin digits by default for both languages (codes, scores and dates mix with English text).
const gregorianLocale: Record<AppLocale, string> = {
  ar: "ar-u-ca-gregory-nu-latn",
  en: "en-GB-u-ca-gregory",
};

const hijriLocale: Record<AppLocale, string> = {
  ar: "ar-SA-u-ca-islamic-umalqura-nu-latn",
  en: "en-u-ca-islamic-umalqura",
};

export function formatGregorian(date: Date, locale: AppLocale, style: DateStyle = "long"): string {
  return new Intl.DateTimeFormat(gregorianLocale[locale], {
    dateStyle: style,
    timeZone: TIME_ZONE,
  }).format(date);
}

export function formatHijri(date: Date, locale: AppLocale, style: DateStyle = "long"): string {
  return new Intl.DateTimeFormat(hijriLocale[locale], {
    dateStyle: style,
    timeZone: TIME_ZONE,
  }).format(date);
}

export function formatDate(
  date: Date,
  locale: AppLocale,
  options: { style?: DateStyle; showHijri?: boolean } = {},
): string {
  const { style = "long", showHijri = false } = options;
  const gregorian = formatGregorian(date, locale, style);
  return showHijri ? `${gregorian} (${formatHijri(date, locale, style)})` : gregorian;
}

export function formatDateTime(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(gregorianLocale[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}

// The calendar day in Saudi time (YYYY-MM-DD). Daily snapshots, due dates and
// "expires today" checks bucket by this, not by the UTC day.
export function toRiyadhDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Whole calendar days from `from` to `to`, counted in Saudi time (negative when `to` is past).
export function daysBetween(from: Date, to: Date): number {
  const start = Date.parse(`${toRiyadhDay(from)}T00:00:00Z`);
  const end = Date.parse(`${toRiyadhDay(to)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
