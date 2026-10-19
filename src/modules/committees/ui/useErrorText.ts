"use client";

import { useTranslations } from "next-intl";

/**
 * The message for a form error. Minutes go through document control, so an upload can fail
 * with a document error (file type, patient data); those keep the documents wording.
 */
export function useErrorText() {
  const t = useTranslations("committees.errors");
  const documents = useTranslations("documents.errors");
  return (code: string) => {
    const key = code as "invalid";
    if (t.has(key)) return t(key);
    return documents.has(key) ? documents(key) : t("invalid");
  };
}
