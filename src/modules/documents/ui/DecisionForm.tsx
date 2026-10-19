"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Label, Textarea } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

/** Approve or reject the version waiting for review. A rejection needs a comment. */
export function DecisionForm({
  versionId,
  action,
}: {
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("documents");
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = useId();
  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="decision-form">
      <input type="hidden" name="versionId" value={versionId} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <Field>
        <Label htmlFor={`${id}-comment`}>{t("decision.comment")}</Label>
        <Textarea
          id={`${id}-comment`}
          name="comment"
          maxLength={2000}
          aria-describedby={`${id}-hint`}
        />
        <FieldHint id={`${id}-hint`}>{t("decision.commentHint")}</FieldHint>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approved" disabled={pending}>
          {t("decision.approve")}
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="outline" disabled={pending}>
          {t("decision.reject")}
        </Button>
      </div>
    </form>
  );
}
