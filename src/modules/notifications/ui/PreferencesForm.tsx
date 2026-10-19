"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";

export function PreferencesForm({
  initial,
  action,
}: {
  initial: { emailImmediate: boolean; emailDigest: boolean; locale: "ar" | "en" | null };
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("notifications");
  const [state, formAction, pending] = useActionState(action, idleState);
  const id = useId();
  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="notification-prefs">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      {state.status === "done" ? <Alert tone="success">{t("prefs.saved")}</Alert> : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="emailImmediate"
          defaultChecked={initial.emailImmediate}
          className="mt-1 size-4"
        />
        <span>{t("prefs.emailImmediate")}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="emailDigest"
          defaultChecked={initial.emailDigest}
          className="mt-1 size-4"
        />
        <span>{t("prefs.emailDigest")}</span>
      </label>
      <Field className="max-w-xs">
        <Label htmlFor={`${id}-locale`}>{t("prefs.locale")}</Label>
        <Select id={`${id}-locale`} name="locale" defaultValue={initial.locale ?? ""}>
          <option value="">{t("prefs.localeDefault")}</option>
          <option value="ar" lang="ar">
            {t("prefs.ar")}
          </option>
          <option value="en" lang="en">
            {t("prefs.en")}
          </option>
        </Select>
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {t("prefs.save")}
        </Button>
      </div>
    </form>
  );
}
