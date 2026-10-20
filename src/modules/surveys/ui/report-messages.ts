import { createTranslator } from "next-intl";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import type { ReportLocale } from "../domain/report";
import type { ReportTranslator } from "./report-html";

// Reports are printed in both languages from one request, so the messages are read
// directly instead of through the request's locale.

const catalogues = { ar, en } as const;

export function reportTranslator(locale: ReportLocale): ReportTranslator {
  const t = createTranslator({
    locale,
    messages: catalogues[locale],
    namespace: "mockSurveys.report",
  });
  return (key, values) => (t as unknown as ReportTranslator)(key, values);
}
