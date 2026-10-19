import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { FrameworkStatus } from "../domain/editions";

const variants = { draft: "warning", active: "success", retired: "default" } as const;

export function StatusBadge({ status }: { status: FrameworkStatus }) {
  const t = useTranslations("standards.status");
  return <Badge variant={variants[status]}>{t(status)}</Badge>;
}
