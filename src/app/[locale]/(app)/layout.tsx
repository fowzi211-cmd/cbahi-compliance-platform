import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AppShellFallback } from "@/components/shell/app-shell-fallback";
import type { NavKey } from "@/components/shell/nav-items";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { allowed } from "@/modules/tenancy/service";

// Everything in this group needs a signed-in member. The check reads the request, so it
// streams inside Suspense and the static frame renders first.
export default function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <AppFrame params={params}>{children}</AppFrame>
    </Suspense>
  );
}

async function AppFrame({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await requireAppContext(locale as Locale);
  const hiddenNav: NavKey[] = allowed(ctx.access, "membership.manage", {
    facilityId: ctx.facilityId,
  })
    ? []
    : ["people"];

  return (
    <AppShell
      userName={ctx.user.name}
      facilities={ctx.facilities}
      activeFacilityId={ctx.facilityId}
      hiddenNav={hiddenNav}
    >
      {children}
    </AppShell>
  );
}
