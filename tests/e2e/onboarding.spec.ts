import AxeBuilder from "@axe-core/playwright";
import { expect, signUpOwner, test, uniqueEmail } from "./fixtures";

// ROADMAP M5 definition of done: the whole wizard, in Arabic. Needs the demo framework
// (`pnpm db:seed`, fictional DEMO-AMB content), in which two elements are tied to hospitals.
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";

test("an owner completes the onboarding wizard in Arabic", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await signUpOwner(page, baseURL!);

  // Until setup is finished, the dashboard points back to the wizard.
  await page.goto("/ar");
  const reminder = page.getByTestId("setup-reminder");
  await expect(reminder).toContainText("أكمل إعداد منشأتك");
  await reminder.getByRole("link", { name: "متابعة الإعداد" }).click();

  // 1. Facility details. The owner corrects the type chosen at sign-up.
  await expect(page).toHaveURL(/\/ar\/onboarding\/facility$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("بيانات المنشأة");
  await page.getByLabel("نوع المنشأة").selectOption("polyclinic");
  await page.getByLabel("رقم الترخيص (اختياري)").fill("DEMO-LIC-0001");
  await page.getByLabel("المدينة (اختياري)").fill("الرياض");
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();

  // 2. Frameworks: the ambulatory demo framework is suggested for a polyclinic.
  await expect(page).toHaveURL(/\/ar\/onboarding\/frameworks$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأطر");
  const demo = page.locator("label").filter({ hasText: DEMO_AR });
  await expect(demo).toContainText("مقترح لنوع منشأتك");
  await expect(demo.getByRole("checkbox")).toBeChecked();
  // Other tests may publish more editions; this journey uses the demo framework only.
  for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
  await demo.getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();

  // 3. Applicability: the two hospital-only elements are out by type.
  await expect(page).toHaveURL(/\/ar\/onboarding\/applicability$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("انطباق العناصر");
  const counts = page.getByTestId("applicability-counts");
  await expect(counts).toHaveText("العناصر: 60 · ينطبق: 58 · لا ينطبق: 2");
  await page.getByLabel("غير المنطبقة فقط").check();
  await page.getByRole("button", { name: "تطبيق" }).click();
  await expect(page).toHaveURL(/na=1/);
  const rows = page.locator("li[data-element]");
  await expect(rows).toHaveCount(2);
  await expect(rows.getByTestId("applicability-reason")).toHaveText([
    "لا ينطبق على نوع منشأتك",
    "لا ينطبق على نوع منشأتك",
  ]);
  await page.getByRole("link", { name: "مسح التصفية" }).click();
  await expect(rows).toHaveCount(60);

  // Rule out an ESR element: the screen warns, and a justification is required.
  const esr = page.locator('li[data-element="DEMO-GOV.1.1"]');
  await esr.locator("summary").click();
  await expect(esr.getByText("هذا عنصر ESR")).toBeVisible();
  await esr.getByLabel("مبرر عدم الانطباق").fill("لا تقدّم المنشأة هذه الخدمة التجريبية.");
  await esr.getByRole("button", { name: "تسجيل أنه لا ينطبق" }).click();
  await expect(counts).toHaveText("العناصر: 60 · ينطبق: 57 · لا ينطبق: 3");
  await expect(page.getByText("عناصر ESR مستبعدة: 1")).toBeVisible();
  await expect(esr.getByTestId("applicability-reason")).toHaveText("لا ينطبق (قرار المنشأة)");

  // Bring in an element the framework ties to hospitals.
  const hospitalOnly = page.locator('li[data-element="DEMO-CARE.2.3"]');
  await hospitalOnly.locator("summary").click();
  await hospitalOnly.getByRole("button", { name: "تسجيل أنه ينطبق" }).click();
  await expect(counts).toHaveText("العناصر: 60 · ينطبق: 58 · لا ينطبق: 2");

  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "متابعة" }).click();

  // 4. Departments.
  await expect(page).toHaveURL(/\/ar\/onboarding\/departments$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأقسام");
  await page.getByLabel("اسم القسم بالعربية").fill("التمريض");
  await page.getByLabel("اسم القسم بالإنجليزية").fill("Nursing");
  await page.getByLabel("نوع القسم").selectOption("nursing");
  await page.getByRole("button", { name: "إضافة القسم" }).click();
  await expect(page.getByTestId("department-list")).toContainText("التمريض");
  await page.getByRole("button", { name: "متابعة" }).click();

  // 5. Team: invite a colleague into the new department.
  await expect(page).toHaveURL(/\/ar\/onboarding\/people$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الفريق");
  const nurse = uniqueEmail("nurse");
  await page.getByLabel("البريد الإلكتروني").fill(nurse);
  await page.getByLabel("الدور").selectOption("staff");
  await page.getByLabel("القسم", { exact: true }).selectOption({ label: "التمريض" });
  await page.getByRole("button", { name: "إرسال الدعوة" }).click();
  await expect(page.getByText("أُرسلت الدعوة.")).toBeVisible();
  await expect(page.getByTestId("onboarding-invitations")).toContainText(nurse);
  await page.getByRole("button", { name: "متابعة", exact: true }).click();

  // 6. Survey cycle: the next survey is suggested three years after the last one.
  await expect(page).toHaveURL(/\/ar\/onboarding\/survey$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("دورة المسح");
  await page.getByLabel("حالة الاعتماد").selectOption("accredited");
  await page.getByLabel("تاريخ آخر مسح").fill("2025-03-15");
  await expect(page.getByLabel("تاريخ المسح القادم المتوقع (اختياري)")).toHaveValue("2028-03-15");
  await page.getByRole("button", { name: "حفظ وإنهاء الإعداد" }).click();

  // Done: every step is marked, and the dashboard reminder is gone.
  await expect(page).toHaveURL(/\/ar\/onboarding$/);
  await expect(page.getByText("اكتمل إعداد المنشأة")).toBeVisible();
  await expect(page.locator('[data-testid="onboarding-steps"]:visible a[data-done]')).toHaveCount(
    6,
  );
  await page.goto("/ar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");
  await expect(page.getByTestId("setup-reminder")).toHaveCount(0);

  // Every step stays editable from Settings, and the decisions were kept.
  await page.goto("/ar/settings");
  await page.getByRole("link", { name: /انطباق العناصر/ }).click();
  await expect(
    page.locator('li[data-element="DEMO-GOV.1.1"]').getByTestId("applicability-reason"),
  ).toHaveText("لا ينطبق (قرار المنشأة)");
});

test("the wizard reads in English, left to right", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/onboarding");
  await expect(page).toHaveURL(/\/en\/onboarding\/facility$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Facility details");
  await page.goto("/en/onboarding/survey");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Survey cycle");
  await page.getByLabel("Accreditation status").selectOption("accredited");
  await page.getByLabel("Date of the last survey").fill("2024-02-29");
  await expect(page.getByLabel("Expected date of the next survey (optional)")).toHaveValue(
    "2027-02-28",
  );
});
