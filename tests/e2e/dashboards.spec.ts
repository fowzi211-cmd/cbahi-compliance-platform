import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, signUpOwner, test } from "./fixtures";

// ROADMAP M13 definition of done: the dashboard renders seeded data in both languages and
// axe passes. The owner scores the pharmacy elements of the fictional demo framework
// (`pnpm db:seed`); the nightly snapshot runs through `pnpm jobs:run` with a fake clock,
// once before the assessment and once after, so the trend has two days.
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";
const PHARMACY = [
  "DEMO-MED.1.1",
  "DEMO-MED.1.2",
  "DEMO-MED.1.3",
  "DEMO-MED.1.4",
  "DEMO-MED.2.1",
  "DEMO-MED.2.2",
  "DEMO-MED.2.3",
];
const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

function snapshot(offset: number) {
  // 23:50 Riyadh, `offset` days from today, as the worker's schedule would run it.
  execFileSync(
    "pnpm",
    ["--silent", "jobs:run", "snapshots", "--now", `${isoDay(offset)}T20:50:00Z`],
    { stdio: "pipe" },
  );
}

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
}

test("the readiness dashboard shows scores, ESR, the trend and the survey countdown", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signUpOwner(page, baseURL!);

  await page.goto("/ar/onboarding/frameworks");
  for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
  await page.locator("label").filter({ hasText: DEMO_AR }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();
  await expect(page).toHaveURL(/\/ar\/onboarding\/applicability$/);
  await page.goto("/ar/onboarding/departments");
  await page.getByLabel("اسم القسم بالعربية").fill("الصيدلية");
  await page.getByLabel("اسم القسم بالإنجليزية").fill("Pharmacy");
  await page.getByLabel("نوع القسم").selectOption("pharmacy");
  await page.getByRole("button", { name: "إضافة القسم" }).click();
  await expect(page.getByTestId("department-list")).toContainText("الصيدلية");

  // The next survey is expected in 60 days: "coming up".
  await page.goto("/ar/onboarding/survey");
  await page.getByLabel("حالة الاعتماد").selectOption("accredited");
  await page.getByLabel("تاريخ آخر مسح").fill(isoDay(-3 * 365 + 60));
  await page.getByLabel("تاريخ المسح القادم المتوقع (اختياري)").fill(isoDay(60));
  await page.getByRole("button", { name: "حفظ وإنهاء الإعداد" }).click();
  // Saved; setup moves on to the first step still open.
  await expect(page).not.toHaveURL(/\/survey$/);

  // Yesterday's snapshot: nothing verified yet.
  snapshot(-1);

  // A pharmacy assessment: every element met except one ESR element.
  await page.goto("/ar/assessments");
  await page.getByLabel("النطاق").selectOption({ label: "الصيدلية" });
  await page.getByRole("button", { name: "بدء التقييم" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تقييم ذاتي: الصيدلية");
  for (const code of PHARMACY) {
    const row = page.locator(`li[data-element="${code}"]:visible`);
    const details = row.locator("details");
    if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
      await row.locator("summary").click();
    }
    if (code === "DEMO-MED.1.1") {
      await row.getByLabel("غير مستوفى", { exact: true }).check();
      await row.getByLabel("التعليق").fill("لا توجد قائمة تحقق في القسم.");
    } else {
      await row.getByLabel("مستوفى", { exact: true }).check();
      await row.getByLabel("نوع الدليل").selectOption({ label: "ملاحظة ميدانية" });
      await row.getByLabel("وصف الدليل").fill("شوهد التطبيق في نوبتين.");
    }
    await row.getByRole("button", { name: "حفظ الدرجة" }).click();
    await expect(row.getByTestId("element-level")).not.toHaveText("");
  }
  await expect(page.getByTestId("assessment-progress")).toHaveText("التقدم: 7 من 7");
  await page.getByRole("button", { name: "إرسال وإقفال" }).click();
  await expect(page.getByTestId("assessment-status").first()).toHaveText("مُرسل ومقفل");

  // Tonight's snapshot.
  snapshot(0);

  await page.goto("/ar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");
  await expect(page.getByTestId("readiness-status")).toHaveText("غير جاهز");
  await expect(page.getByTestId("not-ready-banner")).toContainText("غير جاهز للمسح");
  await expect(page.getByTestId("not-ready-banner")).toContainText(
    "عنصر واحد على الأقل من متطلبات السلامة الأساسية غير مستوفى.",
  );
  await expect(page.getByTestId("esr-panel")).toContainText("DEMO-MED.1.1");
  await expect(page.getByTestId("department-scores")).toContainText("الصيدلية");
  await expect(page.getByTestId("chapter-scores").locator("li")).not.toHaveCount(0);
  await expect(page.getByTestId("unverified-panel")).toContainText("لم يُقيَّم");
  await expect(page.getByTestId("capa-overdue")).toHaveText("المتأخرة: 0");
  await expect(page.getByTestId("survey-days")).toHaveText("60");
  await expect(page.getByTestId("survey-countdown")).toContainText("تقترب");

  // The trend has yesterday and today; the table view carries the same numbers.
  const trend = page.getByTestId("trend");
  await expect(trend.getByRole("img")).toBeVisible();
  await trend.getByText("عرض كجدول").click();
  await expect(trend.locator("tbody tr")).toHaveCount(2);
  await expectAccessible(page);

  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Readiness dashboard");
  await expect(page.getByTestId("readiness-status")).toHaveText("Not ready");
  await expect(page.getByTestId("not-ready-banner")).toContainText("Not ready for survey");
  await expect(page.getByTestId("survey-countdown")).toContainText("60 days left");
  await expect(page.getByTestId("trend").getByRole("img")).toBeVisible();
  await expectAccessible(page);
});
