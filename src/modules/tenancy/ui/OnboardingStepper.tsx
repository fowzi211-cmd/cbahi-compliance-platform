import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { onboardingSteps, type OnboardingStep } from "../domain/onboarding";

/** The wizard's steps. Every step stays reachable, so an owner can go back and fix one. */
export async function OnboardingStepper({
  locale,
  current,
  done,
}: {
  locale: Locale;
  current: OnboardingStep | null;
  done: readonly OnboardingStep[];
}) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  return (
    <nav aria-label={t("title")}>
      <ol className="flex flex-wrap gap-2" data-testid="onboarding-steps">
        {onboardingSteps.map((step, index) => {
          const isDone = done.includes(step);
          const isCurrent = step === current;
          return (
            <li key={step}>
              <Link
                href={`/onboarding/${step}`}
                aria-current={isCurrent ? "step" : undefined}
                data-done={isDone || undefined}
                className={cn(
                  "border-border hover:bg-muted flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
                  isCurrent && "bg-primary text-primary-foreground hover:bg-primary border-primary",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-xs",
                    isDone ? "bg-success text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {isDone ? <Check className="size-3" /> : index + 1}
                </span>
                {t(`steps.${step}`)}
                {isDone && <span className="sr-only">{t("stepDone")}</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
