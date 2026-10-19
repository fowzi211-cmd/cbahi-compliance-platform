"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { capaLimits } from "../domain/capa";

/** A new due date, with the reason kept in the audit log. */
export function RescheduleForm({
  itemId,
  dueOn,
  today,
  action,
}: {
  itemId: string;
  dueOn: string;
  today: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("findings");
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = useId();
  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="capa-reschedule">
      <input type="hidden" name="itemId" value={itemId} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-due`}>{t("capa.newDueOn")}</Label>
          <Input
            id={`${id}-due`}
            name="dueOn"
            type="date"
            required
            min={today}
            defaultValue={dueOn < today ? today : dueOn}
          />
        </Field>
        <Field>
          <Label htmlFor={`${id}-reason`}>{t("capa.reason")}</Label>
          <Input
            id={`${id}-reason`}
            name="reason"
            required
            maxLength={capaLimits.note}
            dir="auto"
          />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {t("capa.reschedule")}
        </Button>
      </div>
    </form>
  );
}
