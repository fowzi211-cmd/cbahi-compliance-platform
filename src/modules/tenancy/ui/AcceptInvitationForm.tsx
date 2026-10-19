"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { idleState, type FormState } from "./form-state";

export function AcceptInvitationForm({
  token,
  action,
}: {
  token: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("invite");
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" disabled={pending}>
        {t("accept")}
      </Button>
    </form>
  );
}
