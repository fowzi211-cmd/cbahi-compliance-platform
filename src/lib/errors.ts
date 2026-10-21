/** Thrown by a service when `can()` denies an action. Pages show a generic "not allowed". */
export class ForbiddenError extends Error {
  constructor(action: string) {
    super(`Not allowed: ${action}`);
    this.name = "ForbiddenError";
  }
}

/**
 * An expected business outcome the user can act on (an expired invitation, a duplicate).
 * `code` maps to a translated message in the UI, so it is part of the service's contract.
 */
export class DomainError<Code extends string = string> extends Error {
  constructor(readonly code: Code) {
    super(code);
    this.name = "DomainError";
  }
}

/** Thrown when a caller has used up a rate limit. Forms show "try again later". */
export class RateLimitedError extends Error {
  constructor(
    readonly rule: string,
    readonly retryAfterSeconds: number,
  ) {
    super(`Rate limited: ${rule}`);
    this.name = "RateLimitedError";
  }
}
