"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "@/lib/form-state";
import {
  accreditationStatuses,
  isCalendarDay,
  suggestNextSurvey,
  type AccreditationStatus,
} from "../domain/survey-cycle";

const idle: FormState = { status: "idle" };

export function SurveyCycleForm({
  cycle,
  submitLabel,
  action,
}: {
  cycle: {
    status: AccreditationStatus;
    lastSurveyOn: string | null;
    nextExpectedOn: string | null;
    notes: string | null;
  };
  submitLabel: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("onboarding");
  const [state, formAction, pending] = useActionState(action, idle);
  const [status, setStatus] = useState(cycle.status);
  const [last, setLast] = useState(cycle.lastSurveyOn ?? "");
  const [next, setNext] = useState(cycle.nextExpectedOn ?? "");
  const surveyed = status !== "never_surveyed";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      {state.status === "error" ? (
        <Alert tone="danger" className="sm:col-span-2">
          {t(`errors.${state.error}` as "errors.invalid")}
        </Alert>
      ) : null}
      <Field className="sm:col-span-2">
        <Label htmlFor="survey-status">{t("survey.status")}</Label>
        <Select
          id="survey-status"
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as AccreditationStatus)}
        >
          {accreditationStatuses.map((s) => (
            <option key={s} value={s}>
              {t(`survey.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      {surveyed && (
        <Field>
          <Label htmlFor="survey-last">{t("survey.lastSurveyOn")}</Label>
          <Input
            id="survey-last"
            name="lastSurveyOn"
            type="date"
            dir="ltr"
            required
            value={last}
            onChange={(event) => {
              const value = event.target.value;
              setLast(value);
              // Fill in the usual three-year date, unless the facility already entered one.
              if (!next && isCalendarDay(value)) setNext(suggestNextSurvey(value));
            }}
          />
        </Field>
      )}
      <Field className={surveyed ? undefined : "sm:col-span-2"}>
        <Label htmlFor="survey-next">{t("survey.nextExpectedOn")}</Label>
        <Input
          id="survey-next"
          name="nextExpectedOn"
          type="date"
          dir="ltr"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          aria-describedby="survey-next-hint"
        />
        <FieldHint id="survey-next-hint">{t("survey.nextHint")}</FieldHint>
      </Field>
      <Field className="sm:col-span-2">
        <Label htmlFor="survey-notes">{t("survey.notes")}</Label>
        <Textarea
          id="survey-notes"
          name="notes"
          maxLength={2000}
          defaultValue={cycle.notes ?? ""}
          aria-describedby="survey-notes-hint"
        />
        <FieldHint id="survey-notes-hint">{t("survey.notesHint")}</FieldHint>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
