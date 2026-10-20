// Rule 10 (ARCHITECTURE §4, "As built in M14"): which features a tenant's subscription turns
// on. Calendar days travel as "YYYY-MM-DD" strings (Riyadh days).

export const tiers = ["platform", "hybrid"] as const;
export type Tier = (typeof tiers)[number];

export const features = [
  // A platform consultant may be assigned to the tenant's facilities.
  "consultantAssignment",
  // Mock surveys run by that consultant (M15).
  "consultantMockSurvey",
  // The consultant-led gap-assessment workflow.
  "gapAssessment",
  // Nightly check that offers help to a facility that is struggling (rule 9).
  "struggleSignal",
] as const;
export type Feature = (typeof features)[number];

export type FeatureOverrides = Partial<Record<Feature, boolean>>;

/**
 * The tier matrix. Every software module is open to every tier; Hybrid adds the consultant
 * services. The struggle signal is for Platform tenants only: a Hybrid tenant already has a
 * consultant watching its readiness, so an automated offer would only be noise.
 */
export const tierMatrix: Record<Tier, Record<Feature, boolean>> = {
  platform: {
    consultantAssignment: false,
    consultantMockSurvey: false,
    gapAssessment: false,
    struggleSignal: true,
  },
  hybrid: {
    consultantAssignment: true,
    consultantMockSurvey: true,
    gapAssessment: true,
    struggleSignal: false,
  },
};

export type SubscriptionTerms = {
  tier: Tier;
  startsOn: string;
  endsOn: string | null;
  featureOverrides: FeatureOverrides;
};

/**
 * The tier in force on `today`. Hybrid is a paid service with a term: before it starts or
 * after it ends the tenant falls back to Platform, so consultants lose access on the day the
 * contract ends without anyone having to remember to revoke them.
 */
export function effectiveTier(terms: SubscriptionTerms, today: string): Tier {
  if (terms.tier === "platform") return "platform";
  if (terms.startsOn > today) return "platform";
  if (terms.endsOn !== null && terms.endsOn < today) return "platform";
  return "hybrid";
}

/** An override, when the platform set one for this tenant, wins over the tier matrix. */
export function featureEnabled(terms: SubscriptionTerms, feature: Feature, today: string) {
  return terms.featureOverrides[feature] ?? tierMatrix[effectiveTier(terms, today)][feature];
}

/** Overrides as stored (jsonb), keeping only known features with boolean values. */
export function parseOverrides(value: unknown): FeatureOverrides {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const result: FeatureOverrides = {};
  for (const feature of features) {
    const v = (value as Record<string, unknown>)[feature];
    if (typeof v === "boolean") result[feature] = v;
  }
  return result;
}

export type SubscriptionProblem = "endsBeforeStart";

export function subscriptionProblem(terms: {
  startsOn: string;
  endsOn: string | null;
}): SubscriptionProblem | null {
  if (terms.endsOn !== null && terms.endsOn < terms.startsOn) return "endsBeforeStart";
  return null;
}
