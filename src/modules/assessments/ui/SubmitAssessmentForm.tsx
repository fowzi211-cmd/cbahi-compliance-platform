"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { idleState, type FormState } from "@/lib/form-state";

export function SubmitAssessmentForm({
  assessmentId,
  remaining,
  action,
}: {
  assessmentId: string;
  remaining: number;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("assessments.submit");
  const tErrors = useTranslations("assessments.errors");
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.status === "error" ? (
        <Alert tone="danger">{tErrors(state.error as "invalid")}</Alert>
      ) : null}
      <p className="text-sm">
        {remaining > 0 ? t("incompleteBody", { count: remaining }) : t("body")}
      </p>
      <div>
        <Button type="submit" disabled={pending || remaining > 0}>
          {t("button")}
        </Button>
      </div>
    </form>
  );
}
