// The onboarding wizard (ROADMAP M5). Each step is saved on its own, so an owner can stop and
// come back; the facility is "onboarded" once every step has been saved at least once.

export const onboardingSteps = [
  "facility",
  "frameworks",
  "applicability",
  "departments",
  "people",
  "survey",
] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (onboardingSteps as readonly string[]).includes(value);
}

/** The first step not yet saved, or null when all are done. */
export function nextOnboardingStep(done: readonly string[]): OnboardingStep | null {
  return onboardingSteps.find((step) => !done.includes(step)) ?? null;
}

/** The step after `step` in the wizard order, or null after the last one. */
export function stepAfter(step: OnboardingStep): OnboardingStep | null {
  return onboardingSteps[onboardingSteps.indexOf(step) + 1] ?? null;
}

/** Saved steps in wizard order, without duplicates or unknown names. */
export function withStepDone(done: readonly string[], step: OnboardingStep): OnboardingStep[] {
  return onboardingSteps.filter((s) => s === step || done.includes(s));
}
