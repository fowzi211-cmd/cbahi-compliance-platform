"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { idleState, type FormState } from "@/lib/form-state";

/** Removes one piece of evidence; refused when the score would be left without any. */
export function RemoveEvidenceButton({
  evidenceId,
  action,
}: {
  evidenceId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("assessments");
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {t("score.removeEvidence")}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          {t(`errors.${state.error}` as "errors.invalid")}
        </p>
      ) : null}
    </form>
  );
}
