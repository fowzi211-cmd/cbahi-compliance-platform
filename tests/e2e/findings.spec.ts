import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, signUpOwner, test } from "./fixtures";

// ROADMAP M9 definition of done: a finding goes to verified closure. A pharmacy assessment
// raises it, an action with evidence closes it, and a later assessment that scores the
// element fully met verifies it. Needs the fictional demo framework (`pnpm db:seed`).
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
const GAP = "DEMO-MED.2.1";

async function assessPharmacy(page: Page, gap: string | null) {
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
    if (code === gap) {
      await row.getByLabel("غير مستوفى", { exact: true }).check();
      await row.getByLabel("التعليق").fill("لا توجد قائمة تحقق في القسم.");
    } else {
      await row.getByLabel("مستوفى", { exact: true }).check();
      await row.getByLabel("نوع الدليل").selectOption({ label: "ملاحظة ميدانية" });
      await row.getByLabel("وصف الدليل").fill("شوهد التطبيق في نوبتين.");
    }
    await row.getByRole("button", { name: "حفظ الدرجة" }).click();
    await expect(row.getByTestId("element-level")).not.toBeEmpty();
  }
  await expect(page.getByTestId("assessment-progress")).toHaveText("التقدم: 7 من 7");
  await page.getByRole("button", { name: "إرسال وإقفال" }).click();
  await expect(page.getByTestId("assessment-status").first()).toHaveText("مُرسل ومقفل");
}

test("a finding is planned, closed with evidence and verified by a later assessment", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await signUpOwner(page, baseURL!);
  await page.goto("/ar/onboarding/frameworks");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأطر");
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

  // The assessment raises one finding.
  await assessPharmacy(page, GAP);
  await page.getByTestId("assessment-findings").getByRole("link", { name: GAP }).click();

  // Plan an action.
  await expect(page.getByTestId("finding-status")).toHaveText("مفتوحة");
  await expect(page.getByText("لا توجد إجراءات تصحيحية بعد.")).toBeVisible();
  const plan = page.getByTestId("capa-form");
  await plan.getByLabel("الإجراء").fill("توفير قائمة تحقق في الصيدلية وتدريب الفريق عليها.");
  await plan.getByLabel("المسؤول").selectOption({ index: 1 });
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await plan.getByLabel("تاريخ الاستحقاق").fill(due);
  await plan.getByRole("button", { name: "إضافة الإجراء" }).click();
  const item = page.locator("li[data-capa]");
  await expect(item.getByTestId("capa-status")).toHaveText("لم يبدأ");
  await expect(page.getByTestId("finding-status")).toHaveText("قيد المعالجة");

  // Done is refused without evidence (anti-decoration).
  const move = item.getByTestId("capa-transition");
  await move.getByLabel("ملاحظة").fill("أُعدّت القائمة.");
  await move.getByRole("button", { name: "تعليم كمنجز" }).click();
  await expect(move.getByRole("alert")).toHaveText("أضف دليل الإغلاق قبل تعليم الإجراء كمنجز.");

  // Attach a link, then close it.
  const evidence = item.getByTestId("capa-evidence-form");
  await evidence.getByLabel("نوع الدليل").selectOption("link");
  await evidence.getByLabel("الرابط").fill("https://dms.example.test/pharmacy/checklist");
  await evidence.getByLabel("الوصف (اختياري)").fill("القائمة المعتمدة وسجل التدريب");
  await evidence.getByRole("button", { name: "إضافة الدليل" }).click();
  await expect(item.getByTestId("capa-evidence")).toContainText(
    "https://dms.example.test/pharmacy/checklist",
  );
  await move.getByLabel("ملاحظة").fill("وُفّرت القائمة ودُرّب أربعة صيادلة.");
  await move.getByRole("button", { name: "تعليم كمنجز" }).click();
  await expect(item.getByTestId("capa-status")).toHaveText("منجز");
  await expect(page.getByTestId("finding-status")).toHaveText("مغلقة");
  await expect(item.getByTestId("capa-closure-note")).toHaveText(
    "وُفّرت القائمة ودُرّب أربعة صيادلة.",
  );

  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  const findingUrl = page.url();

  // The list shows it closed.
  await page.goto("/ar/findings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الملاحظات وخطط التصحيح");
  const listed = page.locator(`li[data-finding="${GAP}"]`);
  await expect(listed.getByTestId("finding-status")).toHaveText("مغلقة");
  await expect(listed).toContainText("أُنجز 1 من 1 إجراءات");

  // A later assessment scores the element fully met: the finding is verified.
  await assessPharmacy(page, null);
  await expect(page.getByTestId("assessment-findings").locator("li[data-finding]")).toHaveCount(0);
  await page.goto(findingUrl);
  await expect(page.getByTestId("finding-status")).toHaveText("تم التحقق");
  await expect(page.getByTestId("finding-verified")).toBeVisible();
  await expect(page.getByTestId("capa-form")).toHaveCount(0);
});

test("the findings screen reads in English", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/findings");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Findings & action plans");
  await expect(page.getByText("No open actions are assigned to you.")).toBeVisible();
  await expect(page.getByText("No findings", { exact: true })).toBeVisible();
});
