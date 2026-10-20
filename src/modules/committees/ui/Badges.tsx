import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { MeetingDueState } from "../domain/schedule";
import type { MinutesStatus } from "../service";

const dueVariants = { onTrack: "default", dueSoon: "warning", overdue: "danger" } as const;

export function MeetingDueBadge({ state }: { state: MeetingDueState }) {
  const t = useTranslations("committees.dueBadge");
  return (
    <Badge variant={dueVariants[state]} data-testid="committee-due">
      {t(state)}
    </Badge>
  );
}

const minutesVariants = {
  missing: "warning",
  inReview: "default",
  approved: "success",
  rejected: "danger",
  retired: "default",
} as const;

export function MinutesBadge({ status }: { status: MinutesStatus }) {
  const t = useTranslations("committees.minutesStatus");
  return (
    <Badge variant={minutesVariants[status]} data-testid="minutes-status">
      {t(status)}
    </Badge>
  );
}
