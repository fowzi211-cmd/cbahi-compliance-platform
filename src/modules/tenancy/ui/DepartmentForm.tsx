"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "./form-state";

export function DepartmentForm({
  types,
  action,
}: {
  // The department-type catalogue, already labelled in the page's language.
  types: { code: string; name: string }[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("onboarding");
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-3">
      {state.status === "error" ? (
        <Alert tone="danger" className="sm:col-span-3">
          {t(`errors.${state.error}` as "errors.invalid")}
        </Alert>
      ) : null}
      <Field>
        <Label htmlFor="department-name-ar">{t("departments.nameAr")}</Label>
        <Input id="department-name-ar" name="nameAr" dir="rtl" lang="ar" required maxLength={200} />
      </Field>
      <Field>
        <Label htmlFor="department-name-en">{t("departments.nameEn")}</Label>
        <Input id="department-name-en" name="nameEn" dir="ltr" lang="en" required maxLength={200} />
      </Field>
      <Field>
        <Label htmlFor="department-type">{t("departments.type")}</Label>
        <Select id="department-type" name="typeCode" defaultValue="">
          <option value="">{t("departments.noType")}</option>
          {types.map((type) => (
            <option key={type.code} value={type.code}>
              {type.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {t("departments.add")}
        </Button>
      </div>
    </form>
  );
}
