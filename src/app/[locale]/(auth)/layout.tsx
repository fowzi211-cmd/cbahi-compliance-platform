import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import type { Locale } from "@/i18n/routing";

// Sign-in, sign-up, MFA enrolment, invitations and first-time setup: one narrow column,
// no app navigation.
export default async function AuthLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations({ locale: locale as Locale, namespace: "common" });
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-4">
        <span className="text-primary text-xl font-bold">{t("appName")}</span>
        {/* Reads the current path, which is request data on pages like /invite/[token]. */}
        <Suspense>
          <LocaleSwitcher />
        </Suspense>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-12 sm:pt-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
