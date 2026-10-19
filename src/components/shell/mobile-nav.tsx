"use client";

import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./sidebar-nav";

// The sidebar becomes a drawer on phones, where department heads run tracers.
export function MobileNav() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("openMenu")}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden />
      </Button>
      {/* Portalled to <body>: the sticky header's backdrop blur would otherwise become the
          containing block for `fixed` and clip the drawer to the header's height. */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
              <div
                id="mobile-nav"
                role="dialog"
                aria-modal="true"
                aria-label={t("label")}
                className="bg-background absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-4 p-4 shadow-xl"
              >
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("closeMenu")}
                    onClick={() => setOpen(false)}
                    autoFocus
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <SidebarNav onNavigate={() => setOpen(false)} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
