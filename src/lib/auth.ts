import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getIP, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { uuidv7 } from "uuidv7";
import {
  isSignInLocked,
  recordPasswordAttempt,
  recordSignIn,
  sessionPolicy,
} from "@/modules/identity/service";
import { authDb } from "./db";
import { env } from "./env";

// Authentication only: who someone is. What they may do is decided by our own policy
// (`can()` in modules/tenancy), not by Better Auth (docs/ARCHITECTURE.md §1 and §6).

// argon2id (the library default) with OWASP's baseline cost: m=19 MiB, t=2, p=1.
const argon2Options = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const SIGN_IN = "/sign-in/email";
// Paths that finish a sign-in for someone with a second factor.
const SECOND_FACTOR = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"];

const bodyEmail = (body: unknown) =>
  typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
    ? body.email
    : null;

function createAuth() {
  const config = env();
  return betterAuth({
    appName: "Mustamir",
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: prismaAdapter(authDb(), { provider: "postgresql" }),
    advanced: {
      cookiePrefix: "mustamir",
      // Our primary keys are UUIDv7 (time-ordered), like every other table.
      database: { generateId: () => uuidv7() },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
      password: {
        hash: (password) => hash(password, argon2Options),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    user: {
      additionalFields: {
        locale: { type: "string", required: false, defaultValue: "ar", input: true },
      },
    },
    session: {
      expiresIn: sessionPolicy.idleSeconds,
      updateAge: sessionPolicy.refreshSeconds,
    },
    // Per client address, in this process's memory (one app instance). Better Auth applies
    // them in production builds only. The address comes from X-Forwarded-For, so the reverse
    // proxy in front of the app must overwrite that header, not append to it.
    rateLimit: {
      customRules: {
        [SIGN_IN]: { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        // On top of the per-account lockout (10 wrong codes): one address guessing codes
        // for many accounts is slowed down too.
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    plugins: [
      twoFactor({
        issuer: "Mustamir",
        // A lost phone must not lock a quality manager out before a survey: backup codes.
        backupCodeOptions: { amount: 10 },
      }),
      // Lets server actions set the session cookie.
      nextCookies(),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN) return;
        const email = bodyEmail(ctx.body);
        if (email && (await isSignInLocked(email))) {
          throw new APIError("FORBIDDEN", {
            code: "ACCOUNT_LOCKED",
            message: "Too many failed attempts. Try again later.",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const ip = ctx.request ? getIP(ctx.request, ctx.context.options) : null;
        if (ctx.path === SIGN_IN) {
          const email = bodyEmail(ctx.body);
          const returned = ctx.context.returned;
          if (email && isAPIError(returned)) {
            if (returned.body?.code === "INVALID_EMAIL_OR_PASSWORD") {
              await recordPasswordAttempt(email, "failure", ip);
            }
            return;
          }
          if (email) await recordPasswordAttempt(email, "success", ip);
          // With a second factor the sign-in finishes on the verify step, audited there.
          const session = ctx.context.newSession;
          if (session && !(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
            await recordSignIn(session.user.id, ip);
          }
          return;
        }
        if (SECOND_FACTOR.includes(ctx.path) && ctx.context.newSession) {
          await recordSignIn(ctx.context.newSession.user.id, ip);
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const holder = globalThis as { __mustamirAuth?: Auth };

/** The Better Auth instance, created on first use so builds do not need runtime secrets. */
export function auth(): Auth {
  return (holder.__mustamirAuth ??= createAuth());
}
