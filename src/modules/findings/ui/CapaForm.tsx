"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { capaLimits } from "../domain/capa";

/** A new corrective action on a finding: what, who, by when. */
export function CapaForm({
  findingId,
  owners,
  today,
  action,
}: {
  findingId: string;
  owners: { value: string; label: string }[];
  // The facility's calendar day, so the date picker cannot offer the past.
  today: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("findings");
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = useId();
  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="capa-form">
      <input type="hidden" name="findingId" value={findingId} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <Field>
        <Label htmlFor={`${id}-action`}>{t("capa.action")}</Label>
        <Textarea
          id={`${id}-action`}
          name="action"
          required
          maxLength={capaLimits.action}
          dir="auto"
          aria-describedby={`${id}-action-hint`}
        />
        <FieldHint id={`${id}-action-hint`}>{t("capa.actionHint")}</FieldHint>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-owner`}>{t("capa.owner")}</Label>
          <Select id={`${id}-owner`} name="ownerUserId" required defaultValue="">
            <option value="" disabled>
              {t("capa.chooseOwner")}
            </option>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label htmlFor={`${id}-due`}>{t("capa.dueOn")}</Label>
          <Input id={`${id}-due`} name="dueOn" type="date" required min={today} />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t("capa.create")}
        </Button>
      </div>
    </form>
  );
}
