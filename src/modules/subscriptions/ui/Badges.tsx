import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/i18n/routing";
import type { RequestStatus, Tier } from "../service";

const statusVariant = {
  offered: "warning",
  open: "default",
  in_progress: "warning",
  done: "success",
  dismissed: "default",
  cancelled: "default",
} as const;

export async function TierBadge({ locale, tier }: { locale: Locale; tier: Tier }) {
  const t = await getTranslations({ locale, namespace: "subscriptions.tiers" });
  return <Badge variant={tier === "hybrid" ? "success" : "default"}>{t(tier)}</Badge>;
}

export async function RequestStatusBadge({
  locale,
  status,
}: {
  locale: Locale;
  status: RequestStatus;
}) {
  const t = await getTranslations({ locale, namespace: "subscriptions.statuses" });
  return (
    <Badge variant={statusVariant[status]} data-testid="request-status">
      {t(status)}
    </Badge>
  );
}

/** The outcome of the last form sent from this page (`?error=` or `?done=1`). */
export async function Feedback({
  locale,
  query,
}: {
  locale: Locale;
  query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: "subscriptions" });
  const error = typeof query.error === "string" ? query.error : null;
  if (error) {
    const key = `errors.${error}` as "errors.invalid";
    return <Alert tone="danger">{t(t.has(key) ? key : "errors.invalid")}</Alert>;
  }
  if (query.done === "1") return <Alert tone="success">{t("saved")}</Alert>;
  return null;
}
