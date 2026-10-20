"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { idleState, type FormState } from "@/lib/form-state";
import { useErrorText } from "./useErrorText";

/** A one-button form (unlink, delete a meeting, archive) that shows its error under it. */
export function CommitteeActionButton({
  fields,
  label,
  action,
  variant = "ghost",
  size = "sm",
}: {
  fields: Record<string, string>;
  label: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}) {
  const errorText = useErrorText();
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
          {errorText(state.error)}
        </p>
      ) : null}
    </form>
  );
}
