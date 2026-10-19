"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Label, Textarea } from "@/components/ui/input";
import type { FormState } from "@/lib/form-state";
import { justificationLimits, type ApplicabilityReason } from "../domain/applicability";

const idle: FormState = { status: "idle" };

/**
 * The one change that makes sense for an element in its current state: rule it out (with a
 * justification), bring it in, or go back to what the framework says.
 */
export function ApplicabilityDecisionForm({
  elementId,
  reason,
  isEsr,
  action,
}: {
  elementId: string;
  reason: ApplicabilityReason;
  isEsr: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("onboarding");
  const [state, formAction, pending] = useActionState(action, idle);
  const id = useId();
  const ruleOut = reason === "applies";
  const bringIn = reason === "otherFacilityType";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="elementId" value={elementId} />
      {/* Going back to the framework's rule is the opposite of the facility's decision. */}
      <input
        type="hidden"
        name="applicable"
        value={String(bringIn || reason === "markedNotApplicable")}
      />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      {ruleOut && isEsr ? <Alert tone="warning">{t("applicability.esrWarning")}</Alert> : null}
      {ruleOut || bringIn ? (
        <Field>
          <Label htmlFor={`${id}-why`}>
            {ruleOut ? t("applicability.justification") : t("applicability.note")}
          </Label>
          <Textarea
            id={`${id}-why`}
            name="justification"
            required={ruleOut}
            minLength={ruleOut ? justificationLimits.min : undefined}
            maxLength={justificationLimits.max}
            aria-describedby={`${id}-hint`}
          />
          <FieldHint id={`${id}-hint`}>
            {ruleOut ? t("applicability.justificationHint") : t("applicability.noteHint")}
          </FieldHint>
        </Field>
      ) : null}
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {ruleOut
            ? t("applicability.markNotApplicable")
            : bringIn
              ? t("applicability.markApplicable")
              : t("applicability.restore")}
        </Button>
      </div>
    </form>
  );
}
