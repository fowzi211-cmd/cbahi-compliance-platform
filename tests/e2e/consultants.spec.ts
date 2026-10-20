import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { expect, PASSWORD, signUpOwner, test, totpCode, uniqueEmail } from "./fixtures";

// ROADMAP M14 definition of done: a consultant can reach only their assigned facility. The
// platform admin makes one tenant Hybrid and assigns a consultant there; a second tenant
// stays on Platform and refuses the assignment. The service-request ticket flow runs between
// the first tenant's owner and the platform team.

async function newPage(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    locale: "ar-SA",
    extraHTTPHeaders: { "x-forwarded-for": `10.202.${Math.floor(Math.random() * 250)}.9` },
  });
  return context.newPage();
}

/** An account with two-factor on and no organization, as a consultant starts. */
async function signUpConsultant(page: Page, baseURL: string) {
  const email = uniqueEmail("consultant");
  const headers = { origin: baseURL };
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: "سارة المستشارة", email, password: PASSWORD, locale: "ar" },
  });
  expect(signUp.ok()).toBe(true);
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
  return email;
}

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
}

test("a consultant reaches only the facility they are assigned to", async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(180_000);
  const tag = randomUUID().slice(0, 6);
  const tenantA = {
    organization: `مجموعة الشفاء ${tag}`,
    facilityAr: `مستوصف الشفاء ${tag}`,
    facilityEn: `Al-Shifa ${tag}`,
  };
  const tenantB = {
    organization: `مجموعة الأمل ${tag}`,
    facilityAr: `عيادات الأمل ${tag}`,
    facilityEn: `Al-Amal ${tag}`,
  };

  // The platform admin, the two owners and the consultant.
  const admin = await signUpOwner(page, baseURL!);
  execFileSync("pnpm", ["--silent", "platform:admin", admin.email], { stdio: "pipe" });
  const ownerA = await newPage(browser, baseURL!);
  await signUpOwner(ownerA, baseURL!, tenantA);
  const ownerB = await newPage(browser, baseURL!);
  await signUpOwner(ownerB, baseURL!, tenantB);
  const consultant = await newPage(browser, baseURL!);
  const consultantEmail = await signUpConsultant(consultant, baseURL!);

  // The admin makes the account a consultant.
  await page.goto("/ar/platform/consultants");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("المستشارون");
  await page.getByLabel("بريد حساب قائم").fill(consultantEmail);
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByTestId("consultant-list")).toContainText(consultantEmail);

  // Tenant B is on Platform: the assignment is refused.
  await page.goto(`/ar/platform/tenants?q=${encodeURIComponent(tenantB.organization)}`);
  await page.getByRole("link", { name: tenantB.organization }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(tenantB.organization);
  await page
    .getByLabel("المستشار", { exact: true })
    .selectOption({ label: `سارة المستشارة (${consultantEmail})` });
  await page.getByRole("button", { name: "إسناد" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "اشتراك هذا المستأجر لا يشمل المستشارين. غيّر الباقة أولًا.",
  );

  // Tenant A becomes Hybrid and gets the consultant.
  await page.goto(`/ar/platform/tenants?q=${encodeURIComponent(tenantA.organization)}`);
  await page.getByRole("link", { name: tenantA.organization }).click();
  await page.getByLabel("الباقة").selectOption("hybrid");
  await page.getByRole("button", { name: "حفظ الاشتراك" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("تم الحفظ.");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("هجين");
  await page
    .getByLabel("المستشار", { exact: true })
    .selectOption({ label: `سارة المستشارة (${consultantEmail})` });
  await page.getByRole("button", { name: "إسناد" }).click();
  await expect(page.getByTestId("platform-facility")).toContainText(consultantEmail);
  await expectAccessible(page);

  // The consultant opens tenant A's facility, and nothing of tenant B.
  await consultant.goto("/ar");
  await expect(consultant.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");
  await expect(consultant.locator("header")).toContainText(tenantA.facilityAr);
  await expect(consultant.locator("body")).not.toContainText(tenantB.facilityAr);
  await expect(consultant.locator("#facility-switcher")).toHaveCount(0);
  // Not an owner or manager: no people, settings subscription or help requests.
  await expect(consultant.getByRole("link", { name: "الأشخاص والصلاحيات" })).toHaveCount(0);
  await expect(consultant.getByRole("link", { name: "طلبات المساعدة" })).toHaveCount(0);

  // The owner of A sees who has access, and asks the platform team for a mock survey.
  await ownerA.goto("/ar/settings");
  await expect(ownerA.getByTestId("facility-consultants")).toContainText(consultantEmail);
  await ownerA.goto("/ar/requests");
  await ownerA.getByLabel("ما الذي تحتاجه؟").selectOption("mock_survey");
  await ownerA.getByLabel("تفاصيل (اختياري)").fill("قبل المسح المتوقع في الربيع.");
  await ownerA.getByRole("button", { name: "إرسال الطلب" }).click();
  const request = ownerA.getByTestId("request-list").locator("li").first();
  await expect(request.getByTestId("request-status")).toHaveText("مُرسل");
  await expectAccessible(ownerA);

  // The platform team starts it with a note; the owner sees both.
  await page.goto("/ar/platform/requests");
  const queued = page
    .getByTestId("platform-requests")
    .locator("li")
    .filter({ hasText: tenantA.organization });
  await queued.getByLabel("ملاحظة للمنشأة (اختياري)").fill("حُدّد موعد الأسبوع القادم.");
  await queued.getByRole("button", { name: "بدء" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("تم الحفظ.");
  await expectAccessible(page);
  await ownerA.reload();
  await expect(request.getByTestId("request-status")).toHaveText("قيد التنفيذ");
  await expect(request).toContainText("فريق المنصة: حُدّد موعد الأسبوع القادم.");

  // Ending the assignment takes the facility away from the consultant at once.
  await page.goto(`/ar/platform/tenants?q=${encodeURIComponent(tenantA.organization)}`);
  await page.getByRole("link", { name: tenantA.organization }).click();
  await page.getByRole("button", { name: "إنهاء الإسناد" }).click();
  await expect(page.getByTestId("platform-facility")).toContainText("لا يوجد مستشار مُسنَد.");
  await consultant.goto("/ar");
  await expect(consultant).toHaveURL(/\/ar\/setup$/);
});

test("the platform screens read in English", async ({ page, baseURL }) => {
  const admin = await signUpOwner(page, baseURL!);
  execFileSync("pnpm", ["--silent", "platform:admin", admin.email], { stdio: "pipe" });
  await page.goto("/en/platform/tenants");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tenants");
  await page.goto("/en/platform/requests");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Help requests");
  await page.goto("/en/platform/consultants");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultants");
  await expectAccessible(page);
});
