"use client";

import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "../domain/auth-errors";

type Enrolment = { totpURI: string; backupCodes: string[] };

/**
 * Two steps: confirm the password (Better Auth requires it to create the secret), then scan
 * the QR code and type one code to prove the authenticator works before MFA is switched on.
 */
export function MfaEnrollForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enrolment) return;
    void QRCode.toDataURL(enrolment.totpURI, { margin: 1, width: 200 }).then(setQr);
  }, [enrolment]);

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(new FormData(event.currentTarget).get("password")),
    });
    setPending(false);
    if (error || !data || !("totpURI" in data)) return setError(authErrorKey(error));
    setEnrolment(data);
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(new FormData(event.currentTarget).get("code")).trim(),
    });
    setPending(false);
    if (error) return setError(authErrorKey(error));
    router.replace("/");
    router.refresh();
  }

  const errorAlert = error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null;

  if (!enrolment) {
    return (
      <form onSubmit={onPassword} className="flex flex-col gap-4">
        {errorAlert}
        <Field>
          <Label htmlFor="password">{t("mfa.confirmPassword")}</Label>
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
          {t("mfa.start")}
        </Button>
      </form>
    );
  }

  const secret = new URL(enrolment.totpURI).searchParams.get("secret") ?? "";
  return (
    <div className="flex flex-col gap-6">
      {errorAlert}
      <ol className="flex list-decimal flex-col gap-4 ps-5">
        <li className="flex flex-col gap-3">
          <span>{t("mfa.scan")}</span>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
            <img
              src={qr}
              alt={t("mfa.qrAlt")}
              width={200}
              height={200}
              className="rounded-md bg-white"
            />
          ) : null}
          <span className="text-muted-foreground text-sm">{t("mfa.manualEntry")}</span>
          <code
            dir="ltr"
            data-testid="totp-secret"
            className="bg-muted rounded p-2 text-sm break-all"
          >
            {secret}
          </code>
        </li>
        <li className="flex flex-col gap-2">
          <span>{t("mfa.saveBackupCodes")}</span>
          <ul dir="ltr" className="bg-muted grid grid-cols-2 gap-1 rounded p-3 font-mono text-sm">
            {enrolment.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </li>
        <li>
          <form onSubmit={onCode} className="flex flex-col gap-3">
            <Field>
              <Label htmlFor="code">{t("mfa.enterCode")}</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                dir="ltr"
                required
                aria-describedby="code-hint"
              />
              <FieldHint id="code-hint">{t("verify.codeHint")}</FieldHint>
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {t("mfa.finish")}
            </Button>
          </form>
        </li>
      </ol>
    </div>
  );
}
