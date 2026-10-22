"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
//
// The countdown lives in timers, not React state: the only render this component causes is
// showing or hiding the warning, so it never competes with the router's own updates after a
// server action. Leaving at the deadline is a full page load, so nothing of the signed-in
// page stays in the router's cache.
const MIN_INTERVAL_MS = 60_000;
const WARN_BEFORE_MS = 2 * 60_000;

type Countdown = { timers: ReturnType<typeof setTimeout>[] };

function signInPath(pathname: string, expired: boolean) {
  const query = `${expired ? "expired=1&" : ""}next=${encodeURIComponent(pathname)}`;
  return `/${document.documentElement.lang}/sign-in?${query}`;
}

/** Restarts the countdown from `sentAt`, the moment the session was last confirmed. */
function restart(
  countdown: Countdown,
  sentAt: number,
  lifetimeMs: number,
  pathname: string,
  onWarn: () => void,
) {
  for (const timer of countdown.timers) clearTimeout(timer);
  const deadline = sentAt + lifetimeMs;
  countdown.timers = [
    setTimeout(onWarn, Math.max(0, deadline - WARN_BEFORE_MS - Date.now())),
    setTimeout(
      () =>
        void authClient.signOut().finally(() => window.location.assign(signInPath(pathname, true))),
      Math.max(0, deadline - Date.now()),
    ),
  ];
}

export function SessionKeepAlive({
  idleSeconds,
  refreshSeconds,
}: {
  idleSeconds: number;
  refreshSeconds: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const last = useRef(0);
  const countdown = useRef<Countdown>({ timers: [] });
  const [warning, setWarning] = useState(false);
  const lifetimeMs = (idleSeconds - refreshSeconds) * 1000;

  useEffect(() => {
    const now = Date.now();
    if (now - last.current < MIN_INTERVAL_MS) return;
    last.current = now;
    void authClient.getSession().then(({ data }) => {
      if (!data) router.replace(`/sign-in?expired=1&next=${encodeURIComponent(pathname)}`);
      else restart(countdown.current, now, lifetimeMs, pathname, () => setWarning(true));
    });
  }, [pathname, router, lifetimeMs]);

  useEffect(() => {
    const current = countdown.current;
    return () => current.timers.forEach(clearTimeout);
  }, []);

  if (!warning) return null;
  return createPortal(
    <IdleWarning
      onStay={async () => {
        const sentAt = Date.now();
        last.current = sentAt;
        const { data } = await authClient.getSession();
        if (!data) return window.location.assign(signInPath(pathname, true));
        restart(countdown.current, sentAt, lifetimeMs, pathname, () => setWarning(true));
        setWarning(false);
      }}
      onSignOut={async () => {
        await authClient.signOut();
        window.location.assign(signInPath(pathname, false));
      }}
    />,
    document.body,
  );
}

function IdleWarning({
  onStay,
  onSignOut,
}: {
  onStay: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const t = useTranslations("shell.idle");
  const [pending, setPending] = useState(false);
  const run = (action: () => Promise<void>) => () => {
    setPending(true);
    void action().finally(() => setPending(false));
  };
  return (
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
          <Button variant="ghost" disabled={pending} onClick={run(onSignOut)}>
            {t("signOut")}
          </Button>
          <Button autoFocus disabled={pending} onClick={run(onStay)}>
            {t("stay")}
          </Button>
        </div>
      </div>
    </div>
  );
}
