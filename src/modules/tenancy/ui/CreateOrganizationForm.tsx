"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { facilityTypes } from "../domain/facility-types";
import { idleState, type FormState } from "./form-state";

export function CreateOrganizationForm({
  action,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("setup");
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <Field>
        <Label htmlFor="organizationName">{t("organizationName")}</Label>
        <Input id="organizationName" name="organizationName" required maxLength={200} />
      </Field>
      <Field>
        <Label htmlFor="facilityNameAr">{t("facilityNameAr")}</Label>
        <Input
          id="facilityNameAr"
          name="facilityNameAr"
          dir="rtl"
          lang="ar"
          required
          maxLength={200}
        />
      </Field>
      <Field>
        <Label htmlFor="facilityNameEn">{t("facilityNameEn")}</Label>
        <Input
          id="facilityNameEn"
          name="facilityNameEn"
          dir="ltr"
          lang="en"
          required
          maxLength={200}
        />
      </Field>
      <Field>
        <Label htmlFor="facilityType">{t("facilityType")}</Label>
        <Select id="facilityType" name="facilityType" required aria-describedby="type-hint">
          {facilityTypes.map((type) => (
            <option key={type} value={type}>
              {t(`facilityTypes.${type}`)}
            </option>
          ))}
        </Select>
        <FieldHint id="type-hint">{t("facilityTypeHint")}</FieldHint>
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
