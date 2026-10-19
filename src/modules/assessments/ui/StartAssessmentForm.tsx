"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

type Option = { value: string; label: string };

/** Picks the edition and the scope (whole facility or one department) of a new assessment. */
export function StartAssessmentForm({
  frameworks,
  scopes,
  action,
}: {
  frameworks: Option[];
  scopes: Option[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("assessments");
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="start-framework">{t("list.framework")}</Label>
          <Select id="start-framework" name="frameworkId" required>
            {frameworks.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label htmlFor="start-scope">{t("list.scope")}</Label>
          <Select id="start-scope" name="departmentId">
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t("list.start")}
        </Button>
      </div>
    </form>
  );
}
