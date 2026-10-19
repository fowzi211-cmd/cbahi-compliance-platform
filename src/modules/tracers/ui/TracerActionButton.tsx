"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { idleState, type FormState } from "@/lib/form-state";

/** A one-button form (start a run, archive, submit) that shows its error under the button. */
export function TracerActionButton({
  fields,
  label,
  action,
  variant = "default",
  size = "default",
}: {
  fields: Record<string, string>;
  label: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}) {
  const t = useTranslations("tracers");
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {label}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          {t(`errors.${state.error}` as "errors.invalid")}
        </p>
      ) : null}
    </form>
  );
}
