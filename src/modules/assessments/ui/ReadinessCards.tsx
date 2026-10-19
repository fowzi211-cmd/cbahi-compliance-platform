import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { formatPercent } from "@/lib/numbers";
import { localized } from "@/modules/standards/service";
import type { FacilityReadiness } from "../service";

const statusVariant = { not_ready: "danger", at_risk: "warning", ready: "success" } as const;

/** Readiness per edition the facility uses, from the current internal scores. */
export async function ReadinessCards({
  locale,
  readiness,
}: {
  locale: Locale;
  readiness: FacilityReadiness[];
}) {
  const t = await getTranslations({ locale, namespace: "dashboard.readiness" });
  return (
    <div className="grid gap-4">
      {readiness.map((r) => (
        <Card key={r.framework.id} className="flex flex-col gap-3" data-testid="readiness">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {localized(locale, r.framework.nameAr, r.framework.nameEn).text || r.framework.code}
            </CardTitle>
            <Badge variant={statusVariant[r.status]} data-testid="readiness-status">
              {t(`status.${r.status}`)}
            </Badge>
          </div>
          <p className="text-3xl font-bold" data-testid="readiness-score">
            {r.score === null ? t("noScore") : formatPercent(r.score)}
          </p>
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            <li data-testid="readiness-coverage">
              {t("coverage", { scored: r.scored, counted: r.counted })}
            </li>
            {r.esrNotMet > 0 && (
              <li className="text-danger">{t("esrNotMet", { count: r.esrNotMet })}</li>
            )}
            {r.esrUnverified > 0 && (
              <li className="text-danger">{t("esrUnverified", { count: r.esrUnverified })}</li>
            )}
            {r.expired > 0 && <li>{t("expired", { count: r.expired })}</li>}
            {r.overdueCapa > 0 && (
              <li className={r.reasons.includes("overdueCapa") ? "text-danger" : undefined}>
                {t("overdueCapa", { count: r.overdueCapa })}
              </li>
            )}
          </ul>
        </Card>
      ))}
    </div>
  );
}
