import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, signUpOwner, test } from "./fixtures";

// Needs the demo framework: `pnpm db:seed` (fictional DEMO-AMB content only).
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";

test.describe("standards library", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signUpOwner(page, baseURL!);
  });

  test("a member browses the demo framework in Arabic with ESR elements first", async ({
    page,
  }) => {
    await page.goto("/ar/standards");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مكتبة المعايير");
    await page.getByRole("link", { name: new RegExp(DEMO_AR) }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEMO_AR);

    const main = page.getByRole("main");
    await expect(main.getByRole("status").filter({ hasText: "60" })).toBeVisible();
    await expect(page.getByTestId("esr-summary").getByRole("listitem")).toHaveCount(10);

    // Within a standard, the ESR element is listed (and highlighted) before the others.
    const chapters = main.locator("section[data-chapter]");
    const firstStandard = chapters.first().locator("ul").first();
    await expect(firstStandard.locator("li").first()).toHaveAttribute("data-esr", "true");
    await expect(firstStandard.locator("li").first()).toContainText("ESR");

    // By department: the pharmacy elements of the medication chapter.
    await page.getByLabel("القسم").selectOption("pharmacy");
    await page.getByRole("button", { name: "تطبيق" }).click();
    await expect(page).toHaveURL(/department=pharmacy/);
    await expect(chapters.locator("h2")).toHaveText([/DEMO-MED/]);

    // By chapter, ESR only.
    await page.goto(page.url().split("?")[0] + "?chapter=DEMO-ENV&esr=1");
    await expect(page.getByTestId("esr-summary").getByRole("listitem")).toHaveCount(2);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("the same framework reads in English, with missing translations flagged", async ({
    page,
  }) => {
    await page.goto("/en/standards");
    await page.getByRole("link", { name: /Demo ambulatory care framework/ }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Demo ambulatory care framework",
    );
    await page.getByLabel("Search code or text").fill("DEMO-CARE.3.2");
    await page.getByRole("button", { name: "Apply" }).click();
    const element = page.locator("li[id^=element-]");
    await expect(element).toHaveCount(1);
    await expect(element).toContainText("Translation missing");
    await expect(element.locator("summary [lang=ar]")).toBeVisible();
  });

  test("platform pages are invisible to a facility owner", async ({ page }) => {
    await page.goto("/ar/platform/standards");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الصفحة غير موجودة");
  });
});

test("the platform admin imports, licenses and publishes a framework", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const owner = await signUpOwner(page, baseURL!);
  execFileSync("pnpm", ["--silent", "platform:admin", owner.email], { stdio: "pipe" });

  const code = `DEMO-E2E${randomUUID().slice(0, 6).toUpperCase()}`;
  const nameAr = `إطار اختبار ${code}`;
  await page.goto("/ar/platform/standards");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مكتبة المعايير");

  // A broken file first: nothing is saved and the row is pointed out.
  await page.getByLabel("الملف").setInputFiles({
    name: "broken.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("chapter_code,standard_code,code,title_ar\nC1,S1,E1,عنصر\nC1,S1,E1,مكرر\n"),
  });
  await page.getByLabel("رمز الإطار").fill(code);
  await page.getByLabel("الإصدار", { exact: true }).fill("1");
  await page.getByLabel("الاسم بالعربية").fill(nameAr);
  await page.getByLabel("البرنامج").selectOption("dental");
  await page.getByRole("button", { name: "فحص ومعاينة" }).click();
  const issues = page.getByTestId("import-issues");
  await expect(issues.locator("[data-code=duplicateCode]")).toContainText("الصف 3");

  // A valid file: preview, then a draft edition.
  await page.getByLabel("الملف").setInputFiles({
    name: "valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "chapter_code,chapter_title_ar,standard_code,standard_title_ar,code,title_ar,is_esr,department_types",
        "C1,فصل تجريبي,S1,معيار تجريبي,E1,عنصر تجريبي 1,نعم,nursing",
        "C1,,S1,,E2,عنصر تجريبي 2,لا,",
      ].join("\n"),
    ),
  });
  await page.getByRole("button", { name: "فحص ومعاينة" }).click();
  await expect(page).toHaveURL(/\/ar\/platform\/standards\/imports\//);
  await expect(page.getByTestId("count-elements")).toHaveText("2");
  await expect(page.getByTestId("count-esr")).toHaveText("1");
  await expect(page.getByTestId("edition-diff")).toContainText("عنصران جديدان");
  await page.getByRole("button", { name: "إنشاء إصدار مسودة" }).click();

  await expect(page).toHaveURL(/\/ar\/platform\/standards\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("مسودة");
  await page.getByRole("button", { name: "نشر الإصدار" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/أضف ملاحظة الترخيص/);

  await page.getByLabel("ملاحظة الترخيص").fill("محتوى خيالي لأغراض الاختبار.");
  await page.getByRole("button", { name: "حفظ ملاحظة الترخيص" }).click();
  await expect(page.getByLabel("ملاحظة الترخيص")).toHaveValue("محتوى خيالي لأغراض الاختبار.");
  await page.getByRole("button", { name: "نشر الإصدار" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("منشور");

  // Live for facilities.
  await page.goto("/ar/standards");
  await expect(page.getByRole("link", { name: new RegExp(nameAr) })).toBeVisible();
});
