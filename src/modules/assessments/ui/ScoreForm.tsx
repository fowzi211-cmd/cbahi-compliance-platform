"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { evidenceKinds, evidenceLimits } from "../domain/assessment";

export type LevelOption = { code: string; label: string; allowed: boolean };

/**
 * Scores one element: a level, a comment, and optionally one new piece of evidence saved
 * with it. Levels an ESR element cannot take are shown but disabled, so the scorer sees why.
 */
export function ScoreForm({
  assessmentId,
  elementId,
  levels,
  current,
  isEsr,
  action,
}: {
  assessmentId: string;
  elementId: string;
  levels: LevelOption[];
  current: { levelCode: string; comment: string | null } | null;
  isEsr: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("assessments");
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="score-form">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="elementId" value={elementId} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      {state.status === "done" ? (
        <p role="status" className="text-success text-sm">
          {t("score.saved")}
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("score.legend")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {levels.map((level) => (
            <label
              key={level.code}
              className="flex min-h-11 items-center gap-2 text-sm has-disabled:opacity-50"
            >
              <input
                type="radio"
                name="levelCode"
                value={level.code}
                required
                disabled={!level.allowed}
                defaultChecked={current?.levelCode === level.code}
                className="size-4"
              />
              {level.label}
            </label>
          ))}
        </div>
        {isEsr ? <FieldHint>{t("score.esrHint")}</FieldHint> : null}
      </fieldset>
      <Field>
        <Label htmlFor={`${id}-comment`}>{t("score.comment")}</Label>
        <Textarea
          id={`${id}-comment`}
          name="comment"
          maxLength={evidenceLimits.comment}
          defaultValue={current?.comment ?? ""}
          aria-describedby={`${id}-comment-hint`}
        />
        <FieldHint id={`${id}-comment-hint`}>{t("score.commentHint")}</FieldHint>
      </Field>
      <fieldset className="border-border flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("score.evidenceLegend")}</legend>
        <Field>
          <Label htmlFor={`${id}-kind`}>{t("score.evidenceKind")}</Label>
          <Select id={`${id}-kind`} name="evidenceKind" defaultValue="">
            <option value="">{t("score.noEvidence")}</option>
            {evidenceKinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`evidenceKinds.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label htmlFor={`${id}-note`}>{t("score.note")}</Label>
          <Textarea
            id={`${id}-note`}
            name="evidenceNote"
            maxLength={evidenceLimits.note}
            aria-describedby={`${id}-note-hint`}
          />
          <FieldHint id={`${id}-note-hint`}>{t("score.noteHint")}</FieldHint>
        </Field>
        <Field>
          <Label htmlFor={`${id}-url`}>{t("score.url")}</Label>
          <Input
            id={`${id}-url`}
            name="evidenceUrl"
            type="url"
            dir="ltr"
            maxLength={evidenceLimits.url}
            aria-describedby={`${id}-url-hint`}
          />
          <FieldHint id={`${id}-url-hint`}>{t("score.urlHint")}</FieldHint>
        </Field>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {t("score.save")}
        </Button>
      </div>
    </form>
  );
}
