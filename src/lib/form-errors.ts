import { ZodError } from "zod";
import { DomainError, ForbiddenError, RateLimitedError } from "./errors";

/**
 * Turns an expected failure into a translation key for the form (`invalid`, `forbidden`,
 * `rateLimited` or a DomainError code). Anything else is a bug and is rethrown to the error boundary.
 */
export function formErrorCode(error: unknown): string {
  if (error instanceof DomainError) return error.code;
  if (error instanceof ForbiddenError) return "forbidden";
  if (error instanceof RateLimitedError) return "rateLimited";
  if (error instanceof ZodError) return "invalid";
  throw error;
}
