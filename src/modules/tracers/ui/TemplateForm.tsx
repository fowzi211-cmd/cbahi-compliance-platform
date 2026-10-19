"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

type Option = { value: string; label: string };
export type FrameworkOption = Option & { chapters: Option[] };

/**
 * A new tracer template. The chapter list follows the chosen edition; ticking none draws
 * from every chapter.
 */
export function TemplateForm({
  frameworks,
  scopes,
  people,
  frequencies,
  limits,
  action,
}: {
  frameworks: FrameworkOption[];
  scopes: Option[];
  people: Option[];
  frequencies: Option[];
  limits: { min: number; max: number; name: number };
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("tracers");
  const [state, formAction, pending] = useActionState(action, idleState);
  const [frameworkId, setFrameworkId] = useState(frameworks[0]?.value ?? "");
  const chapters = frameworks.find((f) => f.value === frameworkId)?.chapters ?? [];

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="tracer-template-form">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      {state.status === "done" ? (
        <p role="status" className="text-success text-sm">
          {t("form.created")}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="tracer-name-ar">{t("form.nameAr")}</Label>
          <Input
            id="tracer-name-ar"
            name="nameAr"
            dir="rtl"
            maxLength={limits.name}
            aria-describedby="tracer-name-hint"
          />
        </Field>
        <Field>
          <Label htmlFor="tracer-name-en">{t("form.nameEn")}</Label>
          <Input
            id="tracer-name-en"
            name="nameEn"
            dir="ltr"
            maxLength={limits.name}
            aria-describedby="tracer-name-hint"
          />
        </Field>
      </div>
      <FieldHint id="tracer-name-hint" className="-mt-2">
        {t("form.nameHint")}
      </FieldHint>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="tracer-framework">{t("form.framework")}</Label>
          <Select
            id="tracer-framework"
            name="frameworkId"
            required
            value={frameworkId}
            onChange={(event) => setFrameworkId(event.target.value)}
          >
            {frameworks.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label htmlFor="tracer-scope">{t("form.scope")}</Label>
          <Select id="tracer-scope" name="departmentId">
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {chapters.length > 0 && (
        <fieldset className="flex flex-col gap-2" aria-describedby="tracer-chapters-hint">
          <legend className="mb-1 text-sm font-medium">{t("form.chapters")}</legend>
          <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
            {chapters.map((chapter) => (
              <label key={chapter.value} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="chapterIds" value={chapter.value} className="size-4" />
                {chapter.label}
              </label>
            ))}
          </div>
          <FieldHint id="tracer-chapters-hint">{t("form.chaptersHint")}</FieldHint>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <Label htmlFor="tracer-size">{t("form.sampleSize")}</Label>
          <Input
            id="tracer-size"
            name="sampleSize"
            type="number"
            inputMode="numeric"
            min={limits.min}
            max={limits.max}
            defaultValue={5}
            required
            aria-describedby="tracer-size-hint"
          />
          <FieldHint id="tracer-size-hint">
            {t("form.sampleSizeHint", { min: limits.min, max: limits.max })}
          </FieldHint>
        </Field>
        <Field>
          <Label htmlFor="tracer-frequency">{t("form.frequency")}</Label>
          <Select id="tracer-frequency" name="frequency" required>
            {frequencies.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label htmlFor="tracer-assignee">{t("form.assignee")}</Label>
          <Select id="tracer-assignee" name="assigneeUserId" defaultValue="">
            <option value="">{t("form.assigneeNone")}</option>
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t("form.create")}
        </Button>
      </div>
    </form>
  );
}
