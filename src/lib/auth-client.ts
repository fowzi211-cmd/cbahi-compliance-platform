"use client";

import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Browser side of Better Auth. Same origin, so no base URL is needed.
export const authClient = createAuthClient({
  plugins: [
    twoFactorClient(),
    // Mirrors `user.additionalFields` in src/lib/auth.ts.
    inferAdditionalFields({ user: { locale: { type: "string", required: false } } }),
  ],
});
