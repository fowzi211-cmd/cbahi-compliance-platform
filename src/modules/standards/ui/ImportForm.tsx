"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { programs } from "../domain/import-format";
import { IssueList } from "./IssueList";
import { idleImportState, type ImportFormState } from "./import-form-state";

export function ImportForm({
  action,
}: {
  action: (state: ImportFormState, form: FormData) => Promise<ImportFormState>;
}) {
  const t = useTranslations("platform.standards.upload");
  const tStandards = useTranslations("standards");
  const tIssues = useTranslations("platform.standards.issues");
  const tErrors = useTranslations("platform.standards.errors");
  const [state, formAction, pending] = useActionState(action, idleImportState);
  const id = useId();
  const errors =
    state.status === "invalid" ? state.issues.filter((i) => i.severity === "error") : [];
  // React resets a form after its action runs; the values typed are restored from the state.
  const typed: Record<string, string> = (state.status === "invalid" && state.framework) || {};

  return (
    <form action={formAction} className="flex flex-col gap-5" encType="multipart/form-data">
      <Field>
        <Label htmlFor={`${id}-file`}>{t("file")}</Label>
        <Input
          id={`${id}-file`}
          name="file"
          type="file"
          required
          accept=".csv,.xlsx,.json"
          aria-describedby={`${id}-file-hint`}
          className="h-auto py-2"
        />
        <FieldHint id={`${id}-file-hint`}>{t("fileHint")}</FieldHint>
      </Field>

      <fieldset className="border-border flex flex-col gap-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{t("csvTitle")}</legend>
        <p className="text-muted-foreground text-sm">{t("csvHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor={`${id}-code`}>{t("code")}</Label>
            <Input
              id={`${id}-code`}
              name="code"
              defaultValue={typed.code ?? ""}
              dir="ltr"
              placeholder="DEMO-AMB"
            />
          </Field>
          <Field>
            <Label htmlFor={`${id}-edition`}>{t("edition")}</Label>
            <Input
              id={`${id}-edition`}
              name="edition"
              defaultValue={typed.edition ?? ""}
              dir="ltr"
              placeholder="2026.1"
            />
          </Field>
          <Field>
            <Label htmlFor={`${id}-name-ar`}>{t("nameAr")}</Label>
            <Input
              id={`${id}-name-ar`}
              name="name_ar"
              defaultValue={typed.name_ar ?? ""}
              dir="rtl"
              lang="ar"
            />
          </Field>
          <Field>
            <Label htmlFor={`${id}-name-en`}>{t("nameEn")}</Label>
            <Input
              id={`${id}-name-en`}
              name="name_en"
              defaultValue={typed.name_en ?? ""}
              dir="ltr"
              lang="en"
            />
          </Field>
          <Field>
            <Label htmlFor={`${id}-program`}>{t("program")}</Label>
            <Select
              key={typed.program ?? ""}
              id={`${id}-program`}
              name="program"
              defaultValue={typed.program ?? ""}
            >
              <option value="">{t("programNone")}</option>
              {programs.map((p) => (
                <option key={p} value={p}>
                  {tStandards(`programs.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      {state.status === "error" && <Alert tone="danger">{tErrors(state.error as "invalid")}</Alert>}
      {state.status === "invalid" && (
        <Alert tone="danger" className="flex flex-col gap-3">
          <p className="font-medium">{tIssues("failed", { count: errors.length })}</p>
          <IssueList issues={state.issues} />
        </Alert>
      )}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("checking") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
