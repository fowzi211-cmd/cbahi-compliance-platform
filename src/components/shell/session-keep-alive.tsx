"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

// Sessions end after 30 minutes without activity (ARCHITECTURE §6). Moving around the app is
// activity, so each navigation (at most once a minute) asks the auth endpoint, which slides
// the expiry and refreshes the cookie. A session that has already ended sends the user to
// sign in again.
//
// The server only slides the expiry when its last refresh is older than `refreshSeconds`, so
// after a ping the session is certain to live `idleSeconds - refreshSeconds` more. Shortly
// before that, a warning offers to stay signed in; at the deadline the page signs out, so a
// screen left open in a clinic does not keep showing compliance data to whoever walks by.
const MIN_INTERVAL_MS = 60_000;
const WARN_BEFORE_MS = 2 * 60_000;

export function SessionKeepAlive({
  idleSeconds,
  refreshSeconds,
}: {
  idleSeconds: number;
  refreshSeconds: number;
}) {
  const t = useTranslations("shell.idle");
  const pathname = usePathname();
  const router = useRouter();
  const last = useRef(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [warning, setWarning] = useState(false);
  const [pending, startTransition] = useTransition();

  const toSignIn = useCallback(
    (expired: boolean) =>
      router.replace(`/sign-in?${expired ? "expired=1&" : ""}next=${encodeURIComponent(pathname)}`),
    [pathname, router],
  );

  const ping = useCallback(async () => {
    const sentAt = Date.now();
    last.current = sentAt;
    const { data } = await authClient.getSession();
    if (!data) return toSignIn(true);
    setWarning(false);
    setDeadline(sentAt + (idleSeconds - refreshSeconds) * 1000);
  }, [idleSeconds, refreshSeconds, toSignIn]);

  useEffect(() => {
    if (Date.now() - last.current < MIN_INTERVAL_MS) return;
    void ping();
  }, [pathname, ping]);

  useEffect(() => {
    if (deadline === null) return;
    const warnIn = deadline - WARN_BEFORE_MS - Date.now();
    const warnTimer = setTimeout(() => setWarning(true), Math.max(0, warnIn));
    const endTimer = setTimeout(
      () => void authClient.signOut().finally(() => toSignIn(true)),
      Math.max(0, deadline - Date.now()),
    );
    return () => {
      clearTimeout(warnTimer);
      clearTimeout(endTimer);
    };
  }, [deadline, toSignIn]);

  if (!warning) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-body"
        className="bg-background border-border flex w-full max-w-md flex-col gap-4 rounded-lg border p-6 shadow-lg"
        data-testid="idle-warning"
      >
        <h2 id="idle-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p id="idle-body" className="text-muted-foreground">
          {t("body", { minutes: Math.round(WARN_BEFORE_MS / 60_000) })}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await authClient.signOut();
                toSignIn(false);
              })
            }
          >
            {t("signOut")}
          </Button>
          <Button autoFocus disabled={pending} onClick={() => startTransition(ping)}>
            {t("stay")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
