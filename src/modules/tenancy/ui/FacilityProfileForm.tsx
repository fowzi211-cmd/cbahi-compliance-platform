"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { facilityTypes } from "../domain/facility-types";
import { idleState, type FormState } from "./form-state";

export type FacilityProfile = {
  nameAr: string;
  nameEn: string;
  type: string;
  licenseNo: string | null;
  city: string | null;
};

export function FacilityProfileForm({
  facility,
  action,
}: {
  facility: FacilityProfile;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      {state.status === "error" ? (
        <Alert tone="danger" className="sm:col-span-2">
          {t(`onboarding.errors.${state.error}` as "onboarding.errors.invalid")}
        </Alert>
      ) : null}
      <Field>
        <Label htmlFor="facility-name-ar">{t("setup.facilityNameAr")}</Label>
        <Input
          id="facility-name-ar"
          name="nameAr"
          dir="rtl"
          lang="ar"
          required
          maxLength={200}
          defaultValue={facility.nameAr}
        />
      </Field>
      <Field>
        <Label htmlFor="facility-name-en">{t("setup.facilityNameEn")}</Label>
        <Input
          id="facility-name-en"
          name="nameEn"
          dir="ltr"
          lang="en"
          required
          maxLength={200}
          defaultValue={facility.nameEn}
        />
      </Field>
      <Field className="sm:col-span-2">
        <Label htmlFor="facility-type">{t("setup.facilityType")}</Label>
        <Select
          id="facility-type"
          name="type"
          required
          defaultValue={facility.type}
          aria-describedby="facility-type-hint"
        >
          {facilityTypes.map((type) => (
            <option key={type} value={type}>
              {t(`setup.facilityTypes.${type}`)}
            </option>
          ))}
        </Select>
        <FieldHint id="facility-type-hint">{t("onboarding.facility.typeHint")}</FieldHint>
      </Field>
      <Field>
        <Label htmlFor="facility-license">{t("onboarding.facility.licenseNo")}</Label>
        <Input
          id="facility-license"
          name="licenseNo"
          dir="ltr"
          maxLength={50}
          defaultValue={facility.licenseNo ?? ""}
        />
      </Field>
      <Field>
        <Label htmlFor="facility-city">{t("onboarding.facility.city")}</Label>
        <Input id="facility-city" name="city" maxLength={100} defaultValue={facility.city ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {t("onboarding.saveAndContinue")}
        </Button>
      </div>
    </form>
  );
}
