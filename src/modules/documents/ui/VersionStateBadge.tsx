import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { VersionState } from "../domain/lifecycle";

const variants: Record<
  VersionState | "retired" | "none",
  "success" | "warning" | "danger" | "default"
> = {
  current: "success",
  reviewDue: "warning",
  expired: "danger",
  pending: "warning",
  rejected: "danger",
  superseded: "default",
  retired: "default",
  none: "default",
};

export function VersionStateBadge({ state }: { state: VersionState | "retired" | "none" }) {
  const t = useTranslations("documents.states");
  return (
    <Badge variant={variants[state]} data-testid="version-state">
      {t(state)}
    </Badge>
  );
}
