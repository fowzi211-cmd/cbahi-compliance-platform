"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

export type FrameworkChoiceItem = {
  id: string;
  code: string;
  edition: string;
  // Already in the reader's language (see `localized`), with the language it is written in.
  name: string;
  lang: "ar" | "en";
  elements: number;
  esr: number;
  suggested: boolean;
  checked: boolean;
  retired: boolean;
};

const idle: FormState = { status: "idle" };

export function FrameworkChoiceForm({
  choices,
  action,
}: {
  choices: FrameworkChoiceItem[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("onboarding");
  const [state, formAction, pending] = useActionState(action, idle);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t("steps.frameworks")}</legend>
        {choices.map((choice) => (
          <label
            key={choice.id}
            className="border-border has-checked:border-primary has-checked:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-md border p-4"
          >
            <input
              type="checkbox"
              name="frameworkId"
              value={choice.id}
              defaultChecked={choice.checked}
              className="mt-1 size-4"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                <span lang={choice.lang} dir="auto">
                  {choice.name}
                </span>
                {choice.suggested && <Badge variant="success">{t("frameworks.suggested")}</Badge>}
                {choice.retired && <Badge variant="warning">{t("frameworks.retired")}</Badge>}
              </span>
              <span className="text-muted-foreground text-sm">
                <bdi dir="ltr">{choice.code}</bdi> ·{" "}
                {t("frameworks.details", {
                  edition: choice.edition,
                  elements: choice.elements,
                  esr: choice.esr,
                })}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {t("saveAndContinue")}
        </Button>
      </div>
    </form>
  );
}
