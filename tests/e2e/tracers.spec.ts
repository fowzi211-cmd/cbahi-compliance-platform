import AxeBuilder from "@axe-core/playwright";
import { expect, signUpOwner, test } from "./fixtures";

// ROADMAP M11 definition of done: a tracer is set up, walked one element per screen and
// submitted, on desktop and on a phone (the mobile project runs it on a Pixel 7). Needs the
// fictional demo framework (`pnpm db:seed`).
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";

test("a pharmacy tracer is set up, walked one element at a time and submitted", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
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

  // Set up a weekly tracer of three elements in the pharmacy.
  await page.goto("/ar/tracers");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الجولات التتبعية");
  await expect(page.getByText("لا توجد قوالب جولات بعد.")).toBeVisible();
  const form = page.getByTestId("tracer-template-form");
  await form.getByLabel("الاسم بالعربية").fill("جولة الصيدلية الأسبوعية");
  await form.getByLabel("النطاق").selectOption({ label: "الصيدلية" });
  await form.getByLabel("عدد العناصر في كل جولة").fill("3");
  await form.getByLabel("التكرار").selectOption("weekly");
  await form.getByRole("button", { name: "إنشاء القالب" }).click();
  await expect(form.getByRole("status")).toHaveText("أُنشئ القالب.");
  const card = page.locator("li[data-template]");
  await expect(card.getByRole("heading", { level: 3 })).toHaveText("جولة الصيدلية الأسبوعية");
  await expect(card.getByTestId("tracer-due")).toHaveText("مستحقة");
  await expect(card).toContainText("3 عناصر في كل جولة");

  // Start a run: one element per screen.
  await card.getByRole("button", { name: "بدء جولة" }).click();
  await expect(page).toHaveURL(/\/ar\/tracers\/runs\/[0-9a-f-]+\?step=1$/);
  await expect(page.getByTestId("tracer-step")).toHaveText("العنصر 1 من 3");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);

  for (let step = 1; step <= 3; step++) {
    await expect(page.getByTestId("tracer-step")).toHaveText(`العنصر ${step} من 3`);
    const stepForm = page.getByTestId("tracer-step-form");
    if (step === 1) {
      await stepForm.getByLabel("غير مستوفى", { exact: true }).check();
      await stepForm.getByLabel("ما الذي رأيته أو سمعته").fill("لا توجد قائمة تحقق على الرف.");
    } else {
      await stepForm.getByLabel("مستوفى", { exact: true }).check();
      await stepForm.getByLabel("طريقة التحقق").selectOption({ label: "مقابلة" });
      await stepForm.getByLabel("ما الذي رأيته أو سمعته").fill("شرح الصيدلي الإجراء كما هو مكتوب.");
    }
    await stepForm
      .getByRole("button", { name: step === 3 ? "حفظ والمراجعة" : "حفظ والتالي" })
      .click();
  }

  // Review, then submit.
  await expect(page.getByRole("heading", { name: "المراجعة والإرسال" })).toBeVisible();
  await expect(page.getByTestId("tracer-progress")).toHaveText("تم التحقق من 3 من 3");
  await expect(page.getByTestId("tracer-element-level")).toHaveText([
    "النتيجة: غير مستوفى",
    "النتيجة: مستوفى",
    "النتيجة: مستوفى",
  ]);
  await page.getByRole("button", { name: "إرسال الجولة" }).click();
  await expect(page.getByRole("heading", { name: "أُرسلت الجولة" })).toBeVisible();
  await expect(page.getByTestId("tracer-findings")).toHaveText("سُجّلت ملاحظة واحدة");
  await expect(page.getByTestId("tracer-sample-note")).toContainText(
    "إعادة السحب بهذا الرمز تعطي العينة نفسها.",
  );

  // The template is no longer due, and the run is on record.
  await page.goto("/ar/tracers");
  await expect(page.locator("li[data-template]").getByTestId("tracer-due")).toHaveText(
    "غير مستحقة",
  );
  const run = page.getByTestId("tracer-runs").locator("li[data-run]");
  await expect(run.getByTestId("assessment-status")).toHaveText("مُرسل ومقفل");
  await expect(run).toContainText("تم التحقق من 3 من 3");

  // The gap it found is a finding with an action plan to come.
  await page.goto("/ar/findings");
  await expect(page.locator("li[data-finding]")).toHaveCount(1);
});

test("the tracers screen reads in English", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/tracers");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tracers");
  await expect(page.getByText("No tracer templates yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New tracer template" })).toBeVisible();
});
