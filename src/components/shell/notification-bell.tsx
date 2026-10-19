import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** The header's way into the inbox, with the unread count for sighted and screen-reader users. */
export async function NotificationBell({ unread }: { unread: number }) {
  const t = await getTranslations("notifications.bell");
  return (
    <Link
      href="/notifications"
      className="hover:bg-muted relative inline-flex size-10 items-center justify-center rounded-md"
      aria-label={t("label", { count: unread })}
      data-testid="notification-bell"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span
          className="bg-danger absolute -end-0.5 -top-0.5 min-w-5 rounded-full px-1 text-center text-xs leading-5 font-semibold text-white"
          aria-hidden
          data-testid="notification-count"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
