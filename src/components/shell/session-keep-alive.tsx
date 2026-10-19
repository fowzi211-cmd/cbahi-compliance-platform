"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

// Sessions end after 30 minutes without activity (ARCHITECTURE §6). Moving around the app is
// activity, so each navigation (at most once a minute) asks the auth endpoint, which slides
// the expiry and refreshes the cookie. A session that has already ended sends the user to
// sign in again.
const MIN_INTERVAL_MS = 60_000;

export function SessionKeepAlive() {
  const pathname = usePathname();
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - last.current < MIN_INTERVAL_MS) return;
    last.current = now;
    void authClient.getSession().then(({ data }) => {
      if (!data) router.replace(`/sign-in?expired=1&next=${encodeURIComponent(pathname)}`);
    });
  }, [pathname, router]);

  return null;
}
