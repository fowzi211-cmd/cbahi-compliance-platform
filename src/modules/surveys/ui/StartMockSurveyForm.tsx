"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

/** Picks the edition of a new mock survey; it always covers the whole facility. */
export function StartMockSurveyForm({
  frameworks,
  action,
}: {
  frameworks: { value: string; label: string }[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("mockSurveys");
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <Field className="sm:max-w-md">
        <Label htmlFor="mock-framework">{t("framework")}</Label>
        <Select id="mock-framework" name="frameworkId" required>
          {frameworks.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {t("start")}
        </Button>
      </div>
    </form>
  );
}
