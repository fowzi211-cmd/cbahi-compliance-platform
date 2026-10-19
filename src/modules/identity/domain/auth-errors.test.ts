import { describe, expect, it } from "vitest";
import { authErrorKey } from "./auth-errors";

describe("authErrorKey", () => {
  it.each([
    [{ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "invalidCredentials"],
    [{ code: "ACCOUNT_LOCKED", status: 403 }, "accountLocked"],
    [{ code: "ACCOUNT_TEMPORARILY_LOCKED", status: 403 }, "accountLocked"],
    [{ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 }, "emailTaken"],
    [{ code: "PASSWORD_TOO_SHORT", status: 400 }, "passwordTooShort"],
    [{ code: "INVALID_CODE", status: 401 }, "invalidCode"],
    [{ status: 429 }, "tooManyRequests"],
    [{ code: "SOMETHING_NEW", status: 500 }, "generic"],
    [null, "generic"],
  ] as const)("%j → %s", (error, expected) => {
    expect(authErrorKey(error)).toBe(expected);
  });
});
