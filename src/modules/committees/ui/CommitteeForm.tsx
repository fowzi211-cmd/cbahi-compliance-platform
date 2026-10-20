"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { useErrorText } from "./useErrorText";

type Option = { value: string; label: string };

/** A new committee, or the settings of an existing one (`committeeId` and `initial` given). */
export function CommitteeForm({
  committeeId,
  initial,
  frequencies,
  people,
  nameLimit,
  action,
}: {
  committeeId?: string;
  initial?: { nameAr: string; nameEn: string; frequency: string; chairUserId: string };
  frequencies: Option[];
  people: Option[];
  nameLimit: number;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("committees.form");
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = committeeId ? `committee-${committeeId}` : "committee-new";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      data-testid={committeeId ? "committee-settings" : "committee-new"}
    >
      {committeeId && <input type="hidden" name="committeeId" value={committeeId} />}
      {state.status === "error" ? <Alert tone="danger">{errorText(state.error)}</Alert> : null}
      {state.status === "done" ? (
        <p role="status" className="text-success text-sm">
          {committeeId ? t("saved") : t("created")}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-name-ar`}>{t("nameAr")}</Label>
          <Input
            id={`${id}-name-ar`}
            name="nameAr"
            dir="rtl"
            maxLength={nameLimit}
            defaultValue={initial?.nameAr}
            aria-describedby={`${id}-name-hint`}
          />
        </Field>
        <Field>
          <Label htmlFor={`${id}-name-en`}>{t("nameEn")}</Label>
          <Input
            id={`${id}-name-en`}
            name="nameEn"
            dir="ltr"
            maxLength={nameLimit}
            defaultValue={initial?.nameEn}
            aria-describedby={`${id}-name-hint`}
          />
        </Field>
      </div>
      <FieldHint id={`${id}-name-hint`} className="-mt-2">
        {t("nameHint")}
      </FieldHint>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-frequency`}>{t("frequency")}</Label>
          <Select
            id={`${id}-frequency`}
            name="frequency"
            required
            defaultValue={initial?.frequency ?? "monthly"}
          >
            {frequencies.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label htmlFor={`${id}-chair`}>{t("chair")}</Label>
          <Select id={`${id}-chair`} name="chairUserId" defaultValue={initial?.chairUserId ?? ""}>
            <option value="">{t("noChair")}</option>
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {committeeId ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}
