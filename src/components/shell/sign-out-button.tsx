"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({
  userName,
  redirectTo = "/sign-in",
}: {
  userName: string;
  redirectTo?: string;
}) {
  const t = useTranslations("shell");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      {userName ? (
        <span className="text-muted-foreground hidden text-sm md:inline">{userName}</span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await authClient.signOut();
            router.replace(redirectTo);
            router.refresh();
          })
        }
      >
        <LogOut aria-hidden className="rtl:-scale-x-100" />
        <span className="sr-only sm:not-sr-only">{t("signOut")}</span>
      </Button>
    </div>
  );
}
