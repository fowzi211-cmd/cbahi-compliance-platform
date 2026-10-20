"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { useErrorText } from "./useErrorText";

export function OverseeElementForm({
  committeeId,
  elements,
  action,
}: {
  committeeId: string;
  elements: { value: string; label: string }[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("committees.detail");
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="committeeId" value={committeeId} />
      <input type="hidden" name="linked" value="true" />
      {state.status === "error" ? (
        <Alert tone="danger" className="w-full">
          {errorText(state.error)}
        </Alert>
      ) : null}
      <Field className="min-w-0 flex-1">
        <Label htmlFor="oversee-element">{t("element")}</Label>
        <Select id="oversee-element" name="elementId" required defaultValue="">
          <option value="" disabled>
            {t("chooseElement")}
          </option>
          {elements.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {t("addElement")}
      </Button>
    </form>
  );
}
