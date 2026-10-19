"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Label, Select, Textarea } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

export type StepLevel = { code: string; label: string; allowed: boolean };

/**
 * One element of a tracer run, sized for a phone held in one hand: the results as large
 * tiles, how it was checked, and what was seen. Saving moves on to the next element.
 */
export function StepForm({
  runId,
  elementId,
  step,
  levels,
  current,
  isEsr,
  checkKinds,
  noteLimit,
  last,
  action,
}: {
  runId: string;
  elementId: string;
  step: number;
  levels: StepLevel[];
  current: { levelCode: string; comment: string | null } | null;
  isEsr: boolean;
  checkKinds: { value: string; label: string }[];
  noteLimit: number;
  last: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("tracers");
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="flex flex-col gap-5" data-testid="tracer-step-form">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="elementId" value={elementId} />
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="existingComment" value={current?.comment ?? ""} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-semibold">{t("run.levelLegend")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {levels.map((level) => (
            <label
              key={level.code}
              className="border-border has-checked:border-primary has-checked:bg-primary/10 flex min-h-14 items-center gap-3 rounded-md border px-4 text-base has-disabled:opacity-50"
            >
              <input
                type="radio"
                name="levelCode"
                value={level.code}
                required
                disabled={!level.allowed}
                defaultChecked={current?.levelCode === level.code}
                className="size-5"
              />
              {level.label}
            </label>
          ))}
        </div>
        {isEsr ? <FieldHint>{t("run.esrHint")}</FieldHint> : null}
      </fieldset>
      <Field>
        <Label htmlFor="step-how">{t("run.how")}</Label>
        <Select
          id="step-how"
          name="evidenceKind"
          defaultValue={checkKinds[0]?.value}
          className="h-12"
        >
          {checkKinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label htmlFor="step-note">{t("run.note")}</Label>
        <Textarea
          id="step-note"
          name="note"
          rows={4}
          maxLength={noteLimit}
          aria-describedby="step-note-hint"
        />
        <FieldHint id="step-note-hint">{t("run.noteHint")}</FieldHint>
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {last ? t("run.saveReview") : t("run.saveNext")}
      </Button>
    </form>
  );
}
