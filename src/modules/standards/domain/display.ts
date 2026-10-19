// Presentation rules for library text that are worth testing on their own.

export type Localized = { text: string; missing: boolean; lang: "ar" | "en" };

/**
 * Text in the reader's language, or the other language flagged as a missing translation
 * (ARCHITECTURE §7). Imported text can legitimately exist in only one language.
 */
export function localized(locale: "ar" | "en", ar: string | null, en: string | null): Localized {
  const preferred = locale === "ar" ? ar : en;
  if (preferred !== null && preferred !== "")
    return { text: preferred, missing: false, lang: locale };
  const other = locale === "ar" ? "en" : "ar";
  return { text: (other === "ar" ? ar : en) ?? "", missing: true, lang: other };
}

/**
 * ESR elements first, then the edition's own order. A facility that misses one ESR element
 * is not ready whatever its overall score, so those are what people must see first.
 */
export function esrFirst<T extends { isEsr: boolean; sort: number }>(elements: readonly T[]): T[] {
  return [...elements].sort((a, b) => Number(b.isEsr) - Number(a.isEsr) || a.sort - b.sort);
}
