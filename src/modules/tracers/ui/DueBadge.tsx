import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { TracerDueState } from "../domain/schedule";

const variants = { notDue: "default", due: "warning", overdue: "danger" } as const;

export function DueBadge({ state }: { state: TracerDueState }) {
  const t = useTranslations("tracers.list.dueBadge");
  return (
    <Badge variant={variants[state]} data-testid="tracer-due">
      {t(state)}
    </Badge>
  );
}
