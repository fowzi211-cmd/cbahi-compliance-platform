"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { navItems, type NavKey } from "./nav-items";

export function SidebarNav({
  onNavigate,
  hidden = [],
}: {
  onNavigate?: () => void;
  // Sections the user has no permission for; the server decides, this only hides the link.
  hidden?: readonly NavKey[];
}) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav aria-label={t("nav.label")}>
      <ul className="flex flex-col gap-1">
        {navItems
          .filter((item) => !hidden.includes(item.key))
          .map(({ key, href, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  <span className="flex-1">{t(`nav.${key}`)}</span>
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
