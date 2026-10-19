import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";

// Shared helpers for journeys that need a signed-in user. Every test creates its own people
// with unique emails, so tests do not depend on each other or on their order.

export const PASSWORD = "correct horse battery staple";

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export function totpCode(secret: string) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
}

const octet = () => Math.floor(Math.random() * 254) + 1;

/** The newest email sent to `to`, read from Mailpit's API. */
export async function waitForEmail(request: APIRequestContext, to: string) {
  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await request.get(`${mailpit}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    const { messages } = (await search.json()) as { messages?: { ID: string }[] };
    if (messages?.length) {
      const message = await request.get(`${mailpit}/api/v1/message/${messages[0]!.ID}`);
      return (await message.json()) as { Subject: string; Text: string; HTML: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email to ${to}`);
}

export type Owner = { email: string; secret: string };

/**
 * Creates an account through the API, the organization through the setup screen, and turns
 * on TOTP through the API. The browser ends signed in as a facility owner on the dashboard.
 */
export async function signUpOwner(page: Page, baseURL: string): Promise<Owner> {
  const email = uniqueEmail("owner");
  const headers = { origin: baseURL };
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: "مالك تجريبي", email, password: PASSWORD, locale: "ar" },
  });
  expect(signUp.ok()).toBe(true);

  await page.goto("/ar/setup");
  await page.getByLabel("اسم المنظمة").fill("مجموعة النور التجريبية");
  await page.getByLabel("اسم المنشأة بالعربية").fill("عيادات النور التجريبية");
  await page.getByLabel("اسم المنشأة بالإنجليزية").fill("Al-Noor Demo Clinics");
  await page.getByRole("button", { name: "إنشاء المنظمة" }).click();
  await expect(page).toHaveURL(/\/ar\/mfa$/);

  const enable = await page.request.post("/api/auth/two-factor/enable", {
    headers,
    data: { password: PASSWORD },
  });
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get("secret")!;
  const verify = await page.request.post("/api/auth/two-factor/verify-totp", {
    headers,
    data: { code: totpCode(secret) },
  });
  expect(verify.ok()).toBe(true);
  return { email, secret };
}

export const test = base.extend({
  // Each test looks like a different client to the auth rate limiter.
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
    await provide(context);
  },
});

export { expect };
