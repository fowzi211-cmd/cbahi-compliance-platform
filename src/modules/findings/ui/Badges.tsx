import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { CapaStatus, EscalationLevel } from "../domain/capa";
import type { FindingSeverity, FindingStatus } from "../domain/severity";

const severityVariant = {
  esr: "danger",
  high: "danger",
  medium: "warning",
  low: "default",
} as const satisfies Record<FindingSeverity, "danger" | "warning" | "default">;

const findingVariant = {
  open: "warning",
  in_progress: "default",
  closed: "success",
  verified: "success",
} as const satisfies Record<FindingStatus, "success" | "warning" | "default">;

const capaVariant = {
  open: "warning",
  in_progress: "default",
  done: "success",
  cancelled: "default",
} as const satisfies Record<CapaStatus, "success" | "warning" | "default">;

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const t = useTranslations("findings.severity");
  return (
    <Badge variant={severityVariant[severity]} data-testid="finding-severity">
      {t(severity)}
    </Badge>
  );
}

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const t = useTranslations("findings.status");
  return (
    <Badge variant={findingVariant[status]} data-testid="finding-status">
      {t(status)}
    </Badge>
  );
}

export function CapaStatusBadge({ status }: { status: CapaStatus }) {
  const t = useTranslations("findings.capa.status");
  return (
    <Badge variant={capaVariant[status]} data-testid="capa-status">
      {t(status)}
    </Badge>
  );
}

/** Overdue, and how far up it has been escalated (rule 7). Nothing when on time. */
export function EscalationBadge({ level }: { level: EscalationLevel }) {
  const t = useTranslations("findings.capa.escalation");
  if (level === 0) return null;
  return (
    <Badge variant="danger" data-testid="capa-overdue">
      {t(`level${level}`)}
    </Badge>
  );
}
