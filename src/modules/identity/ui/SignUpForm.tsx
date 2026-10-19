"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "../domain/auth-errors";

export function SignUpForm({
  invitedEmail,
  afterSignUp,
}: {
  // When joining from an invitation the address is fixed: it must match the invitation.
  invitedEmail?: string;
  afterSignUp: string;
}) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email: invitedEmail ?? String(form.get("email")).trim(),
      password: String(form.get("password")),
      locale,
    });
    setPending(false);
    if (error) return setError(authErrorKey(error));
    router.replace(afterSignUp);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
      <Field>
        <Label htmlFor="name">{t("fields.name")}</Label>
        <Input id="name" name="name" autoComplete="name" required maxLength={200} />
      </Field>
      <Field>
        <Label htmlFor="email">{t("fields.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          dir="ltr"
          required
          defaultValue={invitedEmail}
          readOnly={invitedEmail !== undefined}
        />
      </Field>
      <Field>
        <Label htmlFor="password">{t("fields.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          required
          minLength={12}
          maxLength={128}
          aria-describedby="password-hint"
        />
        <FieldHint id="password-hint">{t("signUp.passwordHint")}</FieldHint>
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {t("signUp.submit")}
      </Button>
    </form>
  );
}
