"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "../domain/auth-errors";

/** The second step of sign-in for people with an authenticator app. */
export function TwoFactorVerifyForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).trim();
    setPending(true);
    setError(null);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError(authErrorKey(error));
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
      <Field>
        <Label htmlFor="code">{useBackup ? t("verify.backupCode") : t("verify.code")}</Label>
        <Input
          id="code"
          name="code"
          key={useBackup ? "backup" : "totp"}
          inputMode={useBackup ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={useBackup ? undefined : "[0-9]{6}"}
          maxLength={useBackup ? 32 : 6}
          dir="ltr"
          required
          autoFocus
          aria-describedby="code-hint"
        />
        <FieldHint id="code-hint">
          {useBackup ? t("verify.backupHint") : t("verify.codeHint")}
        </FieldHint>
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {t("verify.submit")}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setUseBackup(!useBackup)}>
        {useBackup ? t("verify.useApp") : t("verify.useBackup")}
      </Button>
    </form>
  );
}
