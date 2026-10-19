import { isAPIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { authDb, disconnectDb } from "@/lib/db";
import { listAuditEvents } from "@/modules/audit/service";
import { enforceAbsoluteSessionLimit, getUserProfile } from "@/modules/identity/service";
import { createTenant, loadAccessContext } from "@/modules/tenancy/service";
import { uniqueEmail } from "./helpers";

const PASSWORD = "correct horse battery staple";

// A real account through Better Auth, owning a facility so its events land in a tenant log.
async function makeOwnerAccount() {
  const email = uniqueEmail("auth");
  const { user } = await auth().api.signUpEmail({
    body: { name: "Auth Owner", email, password: PASSWORD },
  });
  const { tenant } = await createTenant({
    name: "Auth tenant",
    owner: { email, name: "Auth Owner" },
    facility: { nameAr: "منشأة", nameEn: "Facility", type: "polyclinic" },
  });
  const ctx = (await loadAccessContext(user.id, tenant.id))!;
  return { email, user, ctx };
}

const signIn = (email: string, password: string) =>
  auth()
    .api.signInEmail({ body: { email, password } })
    .then(
      () => "ok" as const,
      (error: unknown) => (isAPIError(error) ? (error.body?.code ?? "?") : Promise.reject(error)),
    );

let account: Awaited<ReturnType<typeof makeOwnerAccount>>;

beforeAll(async () => {
  account = await makeOwnerAccount();
});

afterAll(disconnectDb);

describe("passwords", () => {
  it("are stored as argon2id hashes", async () => {
    const credential = await authDb().account.findFirst({ where: { userId: account.user.id } });
    expect(credential?.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("must be at least 12 characters", async () => {
    await expect(
      auth().api.signUpEmail({
        body: { name: "Short", email: uniqueEmail("short"), password: "short-pass" },
      }),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_TOO_SHORT" } });
  });
});

describe("sign-in audit and lockout", () => {
  it("records a successful sign-in in the user's tenant", async () => {
    expect(await signIn(account.email, PASSWORD)).toBe("ok");
    const events = await listAuditEvents(account.ctx, { entity: "user" });
    expect(events.some((e) => e.action === "login" && e.actorUserId === account.user.id)).toBe(
      true,
    );
  });

  it("locks the account after five wrong passwords, even for the right one", async () => {
    const { email, ctx, user } = await makeOwnerAccount();
    for (let i = 0; i < 5; i++) {
      expect(await signIn(email, "wrong password!!")).toBe("INVALID_EMAIL_OR_PASSWORD");
    }
    expect(await signIn(email, PASSWORD)).toBe("ACCOUNT_LOCKED");

    const events = await listAuditEvents(ctx, { entity: "user", entityId: user.id });
    expect(events.filter((e) => e.action === "lock")).toHaveLength(1);
    expect(events.some((e) => e.action === "login")).toBe(false);
  });

  it("resets the count after a correct password", async () => {
    const { email } = await makeOwnerAccount();
    for (let i = 0; i < 4; i++) await signIn(email, "wrong password!!");
    expect(await signIn(email, PASSWORD)).toBe("ok");
    for (let i = 0; i < 4; i++) await signIn(email, "wrong password!!");
    expect(await signIn(email, PASSWORD)).toBe("ok");
  });
});

describe("sessions", () => {
  it("ends a session 12 hours after sign-in, whatever the activity", async () => {
    const { token } = await auth().api.signInEmail({
      body: { email: account.email, password: PASSWORD },
    });
    const session = (await authDb().session.findUnique({ where: { token } }))!;
    const almost = new Date(session.createdAt.getTime() + 11.9 * 3_600_000);
    expect(await enforceAbsoluteSessionLimit(session, almost)).toBe(false);
    const later = new Date(session.createdAt.getTime() + 12 * 3_600_000);
    expect(await enforceAbsoluteSessionLimit(session, later)).toBe(true);
    expect(await authDb().session.findUnique({ where: { token } })).toBeNull();
  });

  it("slides the idle deadline 30 minutes ahead", async () => {
    const { token } = await auth().api.signInEmail({
      body: { email: account.email, password: PASSWORD },
    });
    const session = (await authDb().session.findUnique({ where: { token } }))!;
    const idleMinutes = (session.expiresAt.getTime() - session.createdAt.getTime()) / 60_000;
    expect(Math.round(idleMinutes)).toBe(30);
  });
});

it("cannot set privileged flags through sign-up", async () => {
  const email = uniqueEmail("sneaky");
  await auth().api.signUpEmail({
    body: {
      name: "Sneaky",
      email,
      password: PASSWORD,
      isPlatformAdmin: true,
      twoFactorEnabled: true,
    } as never,
  });
  const user = await authDb().user.findUnique({ where: { email } });
  const profile = await getUserProfile(user!.id);
  expect(profile).toMatchObject({ isPlatformAdmin: false, twoFactorEnabled: false });
});
