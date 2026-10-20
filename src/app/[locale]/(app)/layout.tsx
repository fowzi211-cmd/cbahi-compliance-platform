import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AppShellFallback } from "@/components/shell/app-shell-fallback";
import type { NavKey } from "@/components/shell/nav-items";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { countUnread } from "@/modules/notifications/service";
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
  const scope = { facilityId: ctx.facilityId };
  const hiddenNav: NavKey[] = [
    ...(allowed(ctx.access, "membership.manage", scope) ? [] : (["people"] as const)),
    ...(allowed(ctx.access, "service.request", scope) ? [] : (["requests"] as const)),
    // Mock surveys are for whoever runs them and whoever reads the whole facility's results.
    ...(allowed(ctx.access, "mockSurvey.run", { ...scope, surveyKind: "internal" }) ||
    allowed(ctx.access, "mockSurvey.run", { ...scope, surveyKind: "consultant" }) ||
    allowed(ctx.access, "dashboard.view", { ...scope, departmentId: null })
      ? []
      : (["mockSurveys"] as const)),
  ];
  const unreadNotifications = await countUnread(ctx.access);

  return (
    <AppShell
      userName={ctx.user.name}
      facilities={ctx.facilities}
      activeFacilityId={ctx.facilityId}
      hiddenNav={hiddenNav}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
