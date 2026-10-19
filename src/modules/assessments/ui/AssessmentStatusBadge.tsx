import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { AssessmentStatus } from "../domain/assessment";

const variants = { in_progress: "warning", submitted: "success" } as const;

export function AssessmentStatusBadge({ status }: { status: AssessmentStatus }) {
  const t = useTranslations("assessments.status");
  return (
    <Badge variant={variants[status]} data-testid="assessment-status">
      {t(status)}
    </Badge>
  );
}
