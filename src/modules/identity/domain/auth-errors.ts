// Maps Better Auth error codes to our translated messages (`auth.errors.*`). Unknown codes
// fall back to a generic message rather than showing library text to the user.
export const authErrorKeys = [
  "invalidCredentials",
  "accountLocked",
  "emailTaken",
  "passwordTooShort",
  "passwordTooLong",
  "invalidCode",
  "tooManyRequests",
  "generic",
] as const;
export type AuthErrorKey = (typeof authErrorKeys)[number];

const byCode: Record<string, AuthErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_PASSWORD: "invalidCredentials",
  ACCOUNT_LOCKED: "accountLocked",
  ACCOUNT_TEMPORARILY_LOCKED: "accountLocked",
  USER_ALREADY_EXISTS: "emailTaken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailTaken",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  PASSWORD_TOO_LONG: "passwordTooLong",
  INVALID_CODE: "invalidCode",
  INVALID_BACKUP_CODE: "invalidCode",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "tooManyRequests",
};

export function authErrorKey(error: { code?: string; status?: number } | null): AuthErrorKey {
  if (!error) return "generic";
  if (error.status === 429) return "tooManyRequests";
  return (error.code && byCode[error.code]) || "generic";
}
