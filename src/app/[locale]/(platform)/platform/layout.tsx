import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { AppShellFallback } from "@/components/shell/app-shell-fallback";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/session";

// Platform administration: the library every tenant reads. Separate from the tenant app
// because the platform admin acts for no facility and has no default access to tenant data.
export default function PlatformLayout({ children, params }: LayoutProps<"/[locale]/platform">) {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <PlatformFrame params={params}>{children}</PlatformFrame>
    </Suspense>
  );
}

async function PlatformFrame({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requirePlatformAdmin(locale as Locale);
  const t = await getTranslations({ locale: locale as Locale });

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:p-2"
      >
        {t("common.skipToContent")}
      </a>
      <header className="border-border bg-background sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4">
        <Link href="/platform/standards" className="text-primary text-xl font-bold">
          {t("common.appName")}
        </Link>
        <span className="text-muted-foreground text-sm">{t("platform.title")}</span>
        <div className="ms-auto flex items-center gap-3">
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <SignOutButton userName={user.name} />
        </div>
      </header>
      <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
