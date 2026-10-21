import { withoutTenant } from "./db";
import { env } from "./env";
import { RateLimitedError } from "./errors";

// The app's own rate limits (ARCHITECTURE §6, M16), for actions that cost the server or the
// mail relay real work: uploads, printed reports, data exports, invitations and download
// links. Sign-in and sign-up are limited by Better Auth (lib/auth.ts). Counters live in
// Postgres, so every app instance shares them and a restart does not reset them.

export const rateLimits = {
  // Each upload is type-checked, hashed and scanned for patient data.
  upload: { windowSeconds: 600, max: 30 },
  // Every download link is a signed URL minted for this person.
  download: { windowSeconds: 600, max: 120 },
  // Printing a report launches a browser.
  reportExport: { windowSeconds: 3600, max: 10 },
  // A full export reads every table and file of the tenant.
  dataExport: { windowSeconds: 3600, max: 3 },
  // Each invitation sends an email.
  invitation: { windowSeconds: 3600, max: 30 },
  // Requests go to the platform team's queue.
  serviceRequest: { windowSeconds: 3600, max: 10 },
} as const satisfies Record<string, { windowSeconds: number; max: number }>;
export type RateLimitRule = keyof typeof rateLimits;

/**
 * Counts one use of `rule` by `subject` (a user id) and throws RateLimitedError once the
 * window's allowance is spent. Call it after the permission check, so someone who may not
 * act at all is told so rather than told to wait.
 */
export async function consumeRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  if (env().RATE_LIMITS === "off") return;
  const { windowSeconds, max } = rateLimits[rule];
  const [result] = await withoutTenant(
    (tx) => tx.$queryRaw<{ allowed: boolean; retry_after_seconds: number }[]>`
      SELECT * FROM app_rate_limit_hit(${`${rule}:${subject}`}, ${windowSeconds}::int, ${max}::int)`,
  );
  if (!result?.allowed) {
    throw new RateLimitedError(rule, result?.retry_after_seconds ?? windowSeconds);
  }
}
