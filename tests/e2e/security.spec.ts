import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { expect, expectAccessible, PASSWORD, signUpOwner, test, uniqueEmail } from "./fixtures";

// ROADMAP M16 definition of done: security headers on every response, sign-in rate limits,
// and the oversight screens (audit log, data export, idle sign-out) for the owner.

const expectSecurityHeaders = (headers: Record<string, string>) => {
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
};

/** Records every CSP violation the page reports, from the first script on. */
async function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`Content Security Policy violation: ${event.violatedDirective}`),
    );
  });
  return violations;
}

test("pages and API routes carry the security headers", async ({ page }) => {
  const signIn = await page.goto("/ar/sign-in");
  expectSecurityHeaders(signIn!.headers());
  const api = await page.request.get("/api/health");
  expectSecurityHeaders(api.headers());
  const auth = await page.request.get("/api/auth/get-session");
  expectSecurityHeaders(auth.headers());
});

test("sign-in attempts from one address are rate limited", async ({ page, baseURL }) => {
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    // A different account each time, so the per-account lockout does not answer first.
    const response = await page.request.post("/api/auth/sign-in/email", {
      headers: { origin: baseURL! },
      data: { email: uniqueEmail("nobody"), password: PASSWORD },
    });
    statuses.push(response.status());
  }
  expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
  expect(statuses.at(-1)).toBe(429);
});

test("the owner reads the audit log and exports the organization's data", async ({
  page,
  baseURL,
}) => {
  const violations = await watchCsp(page);
  await signUpOwner(page, baseURL!);
  await page.goto("/ar");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The audit log: every change so far, with an intact chain.
  await page.goto("/ar/audit");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("سجل التدقيق");
  await expect(page.getByTestId("audit-chain")).toContainText("السلسلة سليمة");
  const list = page.getByTestId("audit-list");
  await expect(list).toContainText("منشأة");
  await expectAccessible(page);

  // Filter by record type through the URL-backed form.
  await page.getByLabel("نوع السجل").selectOption({ label: "منشأة" });
  await page.getByRole("button", { name: "تطبيق" }).click();
  await expect(page).toHaveURL(/entity=facility/);
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list.locator("li")).toContainText("إنشاء · منشأة");
  await page.getByRole("link", { name: "مسح التصفية" }).click();
  await expect(page).toHaveURL(/\/ar\/audit$/);

  // The export: one ZIP with the tables, the people and a README, recorded in the log.
  await page.goto("/ar/settings");
  const card = page.getByTestId("data-export");
  await expect(card).toContainText("تصدير بياناتك");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "تنزيل التصدير (ZIP)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^mustamir-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await JSZip.loadAsync(await readAll(await download.createReadStream()));
  expect(zip.file("data/facility.json")).not.toBeNull();
  expect(zip.file("people.json")).not.toBeNull();
  expect(await zip.file("README.txt")!.async("string")).toContain("Mustamir data export");

  await page.goto("/ar/audit?entity=tenant&action=export");
  await expect(page.getByTestId("audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("audit-list")).toContainText("تصدير");

  // English, too.
  await page.goto("/en/audit");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audit log");
  await expectAccessible(page);

  expect(violations).toEqual([]);
});

test("an idle session warns, can be kept, and then signs out", async ({ page, baseURL }) => {
  await page.clock.install();
  await signUpOwner(page, baseURL!);
  // The page asks the auth endpoint once on load; the idle countdown starts from its answer.
  const pinged = page.waitForResponse((r) => r.url().includes("/api/auth/get-session"));
  await page.goto("/ar/findings");
  await pinged;

  await page.clock.fastForward("23:30");
  const warning = page.getByTestId("idle-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("هل ما زلت هنا؟");
  await expectAccessible(page);
  await warning.getByRole("button", { name: "البقاء متصلًا" }).click();
  await expect(warning).toBeHidden();

  await page.clock.fastForward("26:00");
  await expect(page).toHaveURL(/\/ar\/sign-in\?expired=1/);
});

async function readAll(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
