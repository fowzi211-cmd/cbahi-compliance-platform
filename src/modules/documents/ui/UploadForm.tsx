"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useRef, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { uploadTypes } from "../domain/lifecycle";

type Option = { value: string; label: string };

/**
 * Uploads a new document (type, titles, owner department) or a new version of one. Every
 * upload needs the no-patient-data attestation; when the scan matches, the same form asks
 * the uploader to confirm the file is not patient data before trying again.
 */
export function UploadForm({
  mode,
  documentId,
  scopes = [],
  action,
}: {
  mode: "document" | "version";
  documentId?: string;
  scopes?: Option[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("documents");
  const [state, formAction, pending] = useActionState(action, idleState);
  const [, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const phiDetected = state.status === "error" && state.error === "phiDetected";

  // Submitted by hand so a refused upload keeps the chosen file for the retry.
  useEffect(() => {
    if (state.status === "done") form.current?.reset();
  }, [state]);

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
      data-testid={`upload-${mode}`}
    >
      {documentId && <input type="hidden" name="documentId" value={documentId} />}
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      {state.status === "done" ? (
        <p role="status" className="text-success text-sm">
          {t("upload.uploaded")}
        </p>
      ) : null}
      {mode === "document" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor={`${id}-type`}>{t("upload.type")}</Label>
            <Select id={`${id}-type`} name="type" required defaultValue="policy">
              {uploadTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor={`${id}-scope`}>{t("upload.owner")}</Label>
            <Select id={`${id}-scope`} name="departmentId">
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor={`${id}-title-ar`}>{t("upload.titleAr")}</Label>
            <Input id={`${id}-title-ar`} name="titleAr" maxLength={300} dir="rtl" />
          </Field>
          <Field>
            <Label htmlFor={`${id}-title-en`}>{t("upload.titleEn")}</Label>
            <Input id={`${id}-title-en`} name="titleEn" maxLength={300} dir="ltr" />
          </Field>
        </div>
      )}
      <Field>
        <Label htmlFor={`${id}-file`}>{t("upload.file")}</Label>
        <Input
          id={`${id}-file`}
          name="file"
          type="file"
          required
          accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
          className="py-2"
          aria-describedby={`${id}-file-hint`}
        />
        <FieldHint id={`${id}-file-hint`}>{t("upload.fileHint")}</FieldHint>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <Label htmlFor={`${id}-effective`}>{t("upload.effectiveOn")}</Label>
          <Input id={`${id}-effective`} name="effectiveOn" type="date" />
        </Field>
        <Field>
          <Label htmlFor={`${id}-review`}>{t("upload.reviewOn")}</Label>
          <Input id={`${id}-review`} name="reviewOn" type="date" />
        </Field>
        <Field>
          <Label htmlFor={`${id}-expires`}>{t("upload.expiresOn")}</Label>
          <Input id={`${id}-expires`} name="expiresOn" type="date" />
        </Field>
      </div>
      {mode === "version" && (
        <Field>
          <Label htmlFor={`${id}-note`}>{t("upload.changeNote")}</Label>
          <Textarea id={`${id}-note`} name="changeNote" maxLength={1000} />
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="phiAttested" value="true" required className="mt-1 size-4" />
        <span>{t("upload.attestation")}</span>
      </label>
      {phiDetected && (
        <div className="border-warning bg-warning/10 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm">{t("upload.phiExplain")}</p>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="phiConfirmed"
              value="true"
              required
              className="mt-1 size-4"
            />
            <span>{t("upload.phiConfirm")}</span>
          </label>
        </div>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {mode === "document" ? t("upload.submitDocument") : t("upload.submitVersion")}
        </Button>
      </div>
    </form>
  );
}
