"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Label, Textarea } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { capaLimits, type CapaTransition } from "../domain/capa";

/**
 * Moves an action on: start, complete, cancel or reopen, whichever the caller may do now.
 * One note field serves as the closure note or the reason, as the button chosen needs.
 */
export function TransitionForm({
  itemId,
  transitions,
  action,
}: {
  itemId: string;
  transitions: CapaTransition[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("findings");
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = useId();
  const needsNote = transitions.some((tr) => tr !== "start");
  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="capa-transition">
      <input type="hidden" name="itemId" value={itemId} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      {needsNote && (
        <Field>
          <Label htmlFor={`${id}-note`}>{t("capa.note")}</Label>
          <Textarea
            id={`${id}-note`}
            name="note"
            maxLength={capaLimits.note}
            dir="auto"
            aria-describedby={`${id}-hint`}
          />
          <FieldHint id={`${id}-hint`}>{t("capa.noteHint")}</FieldHint>
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        {transitions.map((tr) => (
          <Button
            key={tr}
            type="submit"
            name="transition"
            value={tr}
            variant={tr === "complete" || tr === "start" ? "default" : "outline"}
            disabled={pending}
          >
            {t(`capa.transitions.${tr}`)}
          </Button>
        ))}
      </div>
    </form>
  );
}
