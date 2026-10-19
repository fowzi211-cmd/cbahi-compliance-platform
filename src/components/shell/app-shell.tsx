import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import type { FacilityOption } from "@/lib/session";
import { FacilitySwitcher } from "./facility-switcher";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileNav } from "./mobile-nav";
import type { NavKey } from "./nav-items";
import { SessionKeepAlive } from "./session-keep-alive";
import { SidebarNav } from "./sidebar-nav";
import { SignOutButton } from "./sign-out-button";
import { TodayDate } from "./today-date";

export async function AppShell({
  children,
  userName,
  facilities,
  activeFacilityId,
  hiddenNav,
}: {
  children: ReactNode;
  userName: string;
  facilities: FacilityOption[];
  activeFacilityId: string;
  hiddenNav: readonly NavKey[];
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const options = facilities.map((f) => ({
    id: f.facilityId,
    name: locale === "ar" ? f.nameAr : f.nameEn,
  }));

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:p-2"
      >
        {t("skipToContent")}
      </a>
      <SessionKeepAlive />
      <header className="border-border bg-background/95 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur">
        <MobileNav hidden={hiddenNav} />
        <Link href="/" className="text-primary text-xl font-bold">
          {t("appName")}
        </Link>
        <FacilitySwitcher options={options} activeId={activeFacilityId} />
        <div className="ms-auto flex items-center gap-3">
          <TodayDate />
          <LocaleSwitcher />
          <SignOutButton userName={userName} />
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="border-border hidden w-72 shrink-0 border-e p-4 lg:block">
          <SidebarNav hidden={hiddenNav} />
        </aside>
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
