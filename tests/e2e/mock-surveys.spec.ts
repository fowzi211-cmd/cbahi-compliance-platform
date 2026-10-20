import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { extractText } from "unpdf";
import { expect, expectAccessible, newPage, signUpConsultant, signUpOwner, test } from "./fixtures";

// ROADMAP M15 definition of done: a consultant runs a mock survey and exports both PDFs.
// The platform admin makes the tenant Hybrid and assigns the consultant; the consultant
// scores every element of the demo framework (`pnpm db:seed`), locks the survey and issues
// the report in Arabic and English, which the owner then finds among the documents.
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";

/** Follows a download link to the signed URL and returns the file. */
async function download(page: Page, href: string) {
  const redirect = await page.request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(303);
  const file = await page.request.get(redirect.headers()["location"]!);
  expect(file.ok()).toBe(true);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  return new Uint8Array(await file.body());
}

test("a consultant runs a mock survey and exports both PDFs", async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(300_000);
  const tag = randomUUID().slice(0, 6);
  const names = {
    organization: `مجموعة الريان ${tag}`,
    facilityAr: `مستوصف الريان ${tag}`,
    facilityEn: `Al-Rayyan ${tag}`,
  };

  // The owner picks the demo framework.
  const owner = await newPage(browser, baseURL!);
  await signUpOwner(owner, baseURL!, names);
  await owner.goto("/ar/onboarding/frameworks");
  for (const box of await owner.getByRole("checkbox").all()) await box.uncheck();
  await owner.locator("label").filter({ hasText: DEMO_AR }).getByRole("checkbox").check();
  await owner.getByRole("button", { name: "حفظ ومتابعة" }).click();
  await expect(owner).toHaveURL(/\/ar\/onboarding\/applicability$/);
  // The owner watches mock surveys but does not run them.
  await owner.goto("/ar/mock-surveys");
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText("المسح التجريبي");
  await expect(owner.getByRole("button", { name: "بدء المسح" })).toHaveCount(0);

  // The platform admin makes the tenant Hybrid and assigns a consultant.
  const admin = await signUpOwner(page, baseURL!);
  execFileSync("pnpm", ["--silent", "platform:admin", admin.email], { stdio: "pipe" });
  const consultant = await newPage(browser, baseURL!);
  const consultantEmail = await signUpConsultant(consultant, baseURL!);
  await page.goto("/ar/platform/consultants");
  await page.getByLabel("بريد حساب قائم").fill(consultantEmail);
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByTestId("consultant-list")).toContainText(consultantEmail);
  await page.goto(`/ar/platform/tenants?q=${encodeURIComponent(names.organization)}`);
  await page.getByRole("link", { name: names.organization }).click();
  await page.getByLabel("الباقة").selectOption("hybrid");
  await page.getByRole("button", { name: "حفظ الاشتراك" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("تم الحفظ.");
  await page
    .getByLabel("المستشار", { exact: true })
    .selectOption({ label: `سارة المستشارة (${consultantEmail})` });
  await page.getByRole("button", { name: "إسناد" }).click();
  await expect(page.getByRole("button", { name: "إنهاء الإسناد" })).toBeVisible();

  // The consultant starts a mock survey of the demo framework.
  await consultant.goto("/ar/mock-surveys");
  await expect(consultant.getByRole("heading", { level: 1 })).toHaveText("المسح التجريبي");
  await expect(consultant.getByTestId("mock-survey-list")).toHaveCount(0);
  await expectAccessible(consultant);
  await consultant.getByLabel("المعيار").selectOption({ index: 0 });
  await consultant.getByRole("button", { name: "بدء المسح" }).click();
  await expect(consultant).toHaveURL(/\/ar\/mock-surveys\/[0-9a-f-]{36}$/);
  await expect(consultant.getByRole("heading", { level: 1 })).toContainText("مسح تجريبي");
  await expect(consultant.locator("main")).toContainText("مسح المستشار");
  await expect(consultant.locator("main")).toContainText("المقيِّم: سارة المستشارة");

  // Every element: the first Met with an observation, the rest Not Met with a comment.
  const rows = consultant.locator("li[data-element]:visible");
  const codes = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-element")!));
  expect(codes.length).toBeGreaterThan(10);
  for (const [i, code] of codes.entries()) {
    const el = consultant.locator(`li[data-element="${code}"]:visible`);
    const details = el.locator("details");
    if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
      await el.locator("summary").click();
    }
    if (i === 0) {
      await el.getByLabel("مستوفى", { exact: true }).check();
      await el.getByLabel("نوع الدليل").selectOption({ label: "ملاحظة ميدانية" });
      await el.getByLabel("وصف الدليل").fill("شوهد التطبيق في العيادة.");
    } else {
      await el.getByLabel("غير مستوفى", { exact: true }).check();
      await el.getByLabel("التعليق").fill(`لم يُطبَّق يوم المسح (${i}).`);
    }
    await el.getByRole("button", { name: "حفظ الدرجة" }).click();
    await expect(el.getByTestId("element-level")).toHaveText(i === 0 ? "مستوفى" : "غير مستوفى");
  }
  await expect(consultant.getByTestId("assessment-progress")).toHaveText(
    `التقدم: ${codes.length} من ${codes.length}`,
  );

  // Lock it. The report cannot be issued before.
  await expect(consultant.getByTestId("mock-survey-report")).toHaveCount(0);
  await consultant.getByRole("button", { name: "إرسال وإقفال" }).click();
  await expect(consultant.getByTestId("assessment-status").first()).toHaveText("مُرسل ومقفل");
  const report = consultant.getByTestId("mock-survey-report");
  await expect(report).toContainText("تقرير الملاحظات");
  await expectAccessible(consultant);

  // Issue the report in both languages.
  await report.getByLabel("أؤكد أن التقرير لا يحتوي بيانات تعريفية لمرضى.").check();
  await report.getByRole("button", { name: "إصدار التقرير (PDF)" }).click();
  await expect(report.locator("a[data-report]")).toHaveCount(2, { timeout: 60_000 });
  await expect(report.locator('a[data-report="ar"]')).toHaveText("تنزيل النسخة العربية (PDF)");
  await expect(report.locator('a[data-report="en"]')).toHaveText("تنزيل النسخة الإنجليزية (PDF)");
  await expect(report.getByRole("button", { name: "إصدار التقرير (PDF)" })).toHaveCount(0);

  const en = await download(
    consultant,
    (await report.locator('a[data-report="en"]').getAttribute("href"))!,
  );
  const ar = await download(
    consultant,
    (await report.locator('a[data-report="ar"]').getAttribute("href"))!,
  );
  const { text: enText, totalPages } = await extractText(en, { mergePages: true });
  expect(totalPages).toBeGreaterThan(1);
  expect(enText).toContain("Mock survey findings report");
  expect(enText).toContain(names.facilityEn);
  expect(enText).toContain("Not ready");
  expect(enText).toContain(codes[1]!);
  const { text: arText } = await extractText(ar, { mergePages: true });
  expect(arText).toContain(codes[1]!);
  expect(arText.length).toBeGreaterThan(500);

  // The owner finds both among the facility's documents, as reports.
  await owner.goto("/ar/mock-surveys");
  await expect(owner.getByTestId("mock-survey-list")).toContainText("مسح المستشار");
  await owner.goto("/ar/documents");
  await expect(owner.locator("main")).toContainText("تقرير المسح التجريبي");
  await expectAccessible(owner);

  // And reads the survey in English.
  await owner.goto("/en/mock-surveys");
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText("Mock surveys");
  await owner.getByTestId("mock-survey-list").getByRole("link").first().click();
  await expect(owner.getByTestId("mock-survey-report").locator('a[data-report="en"]')).toHaveText(
    "Download the English version (PDF)",
  );
  await expectAccessible(owner);
});
