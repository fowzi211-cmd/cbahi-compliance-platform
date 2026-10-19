"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "../domain/auth-errors";

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError(authErrorKey(error));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      return router.push(`/sign-in/verify?next=${encodeURIComponent(next)}`);
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
      {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
      <Field>
        <Label htmlFor="email">{t("fields.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
      </Field>
      <Field>
        <Label htmlFor="password">{t("fields.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {t("signIn.submit")}
      </Button>
    </form>
  );
}
