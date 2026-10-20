"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { useErrorText } from "./useErrorText";

/** Records a meeting that took place; `today` (Riyadh) caps the date picker. */
export function MeetingForm({
  committeeId,
  today,
  action,
}: {
  committeeId: string;
  today: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("committees.detail");
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" data-testid="meeting-form">
      <input type="hidden" name="committeeId" value={committeeId} />
      {state.status === "error" ? (
        <Alert tone="danger" className="w-full">
          {errorText(state.error)}
        </Alert>
      ) : null}
      <Field>
        <Label htmlFor="meeting-held-on">{t("heldOn")}</Label>
        <Input
          id="meeting-held-on"
          name="heldOn"
          type="date"
          required
          max={today}
          defaultValue={today}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {t("recordMeeting")}
      </Button>
    </form>
  );
}
