"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

export function LinkElementForm({
  documentId,
  elements,
  action,
}: {
  documentId: string;
  elements: { value: string; label: string }[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("documents");
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="linked" value="true" />
      {state.status === "error" ? (
        <Alert tone="danger" className="w-full">
          {t(`errors.${state.error}` as "errors.invalid")}
        </Alert>
      ) : null}
      <Field className="min-w-0 flex-1">
        <Label htmlFor="link-element">{t("links.element")}</Label>
        <Select id="link-element" name="elementId" required defaultValue="">
          <option value="" disabled>
            {t("links.choose")}
          </option>
          {elements.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {t("links.link")}
      </Button>
    </form>
  );
}
