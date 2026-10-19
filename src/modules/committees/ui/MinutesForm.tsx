"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { useErrorText } from "./useErrorText";

/**
 * Files a meeting's minutes. Titles come prefilled from the committee and the date. Like any
 * upload it needs the no-patient-data attestation, and asks for a confirmation when the scan
 * matches.
 */
export function MinutesForm({
  meetingId,
  defaultTitles,
  action,
}: {
  meetingId: string;
  defaultTitles: { ar: string; en: string };
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("committees.minutes");
  const documents = useTranslations("documents.upload");
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, idleState);
  const [, startTransition] = useTransition();
  const id = useId();
  const phiDetected = state.status === "error" && state.error === "phiDetected";

  return (
    <form
      // Submitted by hand so a refused upload keeps the chosen file for the retry.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
      data-testid="minutes-form"
    >
      <input type="hidden" name="meetingId" value={meetingId} />
      {state.status === "error" ? <Alert tone="danger">{errorText(state.error)}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-title-ar`}>{documents("titleAr")}</Label>
          <Input
            id={`${id}-title-ar`}
            name="titleAr"
            maxLength={300}
            dir="rtl"
            defaultValue={defaultTitles.ar}
          />
        </Field>
        <Field>
          <Label htmlFor={`${id}-title-en`}>{documents("titleEn")}</Label>
          <Input
            id={`${id}-title-en`}
            name="titleEn"
            maxLength={300}
            dir="ltr"
            defaultValue={defaultTitles.en}
          />
        </Field>
      </div>
      <Field>
        <Label htmlFor={`${id}-file`}>{documents("file")}</Label>
        <Input
          id={`${id}-file`}
          name="file"
          type="file"
          required
          accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
          className="py-2"
          aria-describedby={`${id}-file-hint`}
        />
        <FieldHint id={`${id}-file-hint`}>{t("fileHint")}</FieldHint>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="phiAttested" value="true" required className="mt-1 size-4" />
        <span>{documents("attestation")}</span>
      </label>
      {phiDetected && (
        <div className="border-warning bg-warning/10 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm">{documents("phiExplain")}</p>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="phiConfirmed"
              value="true"
              required
              className="mt-1 size-4"
            />
            <span>{documents("phiConfirm")}</span>
          </label>
        </div>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
