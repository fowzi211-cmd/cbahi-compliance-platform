import AxeBuilder from "@axe-core/playwright";
import { makePdf } from "../../src/modules/documents/test-files";
import { expect, signUpOwner, test } from "./fixtures";

// ROADMAP M12 definition of done: committee CRUD, and approved minutes count as evidence on
// the elements the committee oversees. Needs the fictional demo framework (`pnpm db:seed`)
// and object storage (docker compose).
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";
const COMMITTEE = "لجنة سلامة الأدوية التجريبية";
const MINUTES = "محضر لجنة سلامة الأدوية التجريبية";
const pdf = (...lines: string[]) =>
  Buffer.from(makePdf([...lines, `Fictional ${Date.now()} ${Math.random()}`]));

test("a committee meets, files minutes, and the approved minutes are cited in a score", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(150_000);
  await signUpOwner(page, baseURL!);
  await page.goto("/ar/onboarding/frameworks");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأطر");
  for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
  await page.locator("label").filter({ hasText: DEMO_AR }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();
  await expect(page).toHaveURL(/\/ar\/onboarding\/applicability$/);

  // Create.
  await page.goto("/ar/committees");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("اللجان");
  await expect(page.getByText("لا توجد لجان بعد.")).toBeVisible();
  const form = page.getByTestId("committee-new");
  await form.getByLabel("الاسم (عربي)").fill(COMMITTEE);
  await form.getByLabel("عدد مرات الاجتماع").selectOption("quarterly");
  await form.getByRole("button", { name: "إنشاء اللجنة" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COMMITTEE);
  await expect(page.getByTestId("committee-summary")).toContainText("تجتمع كل ثلاثة أشهر");

  // Update: it must meet monthly after all.
  const settings = page.getByTestId("committee-settings");
  await settings.getByLabel("عدد مرات الاجتماع").selectOption("monthly");
  await settings.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(settings.getByText("حُفظت التغييرات.")).toBeVisible();
  await expect(page.getByTestId("committee-summary")).toContainText("تجتمع شهريًا");

  // The element it oversees.
  const select = page.getByLabel("العنصر");
  const value = await select.locator("option", { hasText: "DEMO-MED.1.2 " }).getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page.getByTestId("overseen-elements")).toContainText("DEMO-MED.1.2");

  // Two meetings; one was entered by mistake and is deleted.
  const meetingForm = page.getByTestId("meeting-form");
  await meetingForm.getByLabel("تاريخ الاجتماع").fill("2026-01-05");
  await meetingForm.getByRole("button", { name: "تسجيل اجتماع" }).click();
  const mistake = page.locator('li[data-meeting="2026-01-05"]');
  await expect(mistake.getByTestId("minutes-status")).toHaveText("لا يوجد محضر");
  await meetingForm.getByLabel("تاريخ الاجتماع").fill("2026-02-10");
  await meetingForm.getByRole("button", { name: "تسجيل اجتماع" }).click();
  const meeting = page.locator('li[data-meeting="2026-02-10"]');
  await expect(meeting.getByTestId("minutes-status")).toHaveText("لا يوجد محضر");
  await mistake.getByRole("button", { name: "حذف الاجتماع" }).click();
  await expect(mistake).toHaveCount(0);

  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);

  // File the minutes, then approve them like any document.
  await meeting.locator("summary").click();
  const minutes = meeting.getByTestId("minutes-form");
  await expect(minutes.getByLabel("العنوان بالعربية")).toHaveValue(/^محضر لجنة سلامة الأدوية/);
  await minutes.getByLabel("العنوان بالعربية").fill(MINUTES);
  await minutes.getByLabel("الملف", { exact: true }).setInputFiles({
    name: "minutes.pdf",
    mimeType: "application/pdf",
    buffer: pdf("Demo committee minutes", "Decision: fridge logs reviewed weekly."),
  });
  await minutes.getByLabel(/أقرّ بأن هذا الملف لا يحتوي/).check();
  await minutes.getByRole("button", { name: "رفع المحضر" }).click();
  await expect(meeting.getByTestId("minutes-status")).toHaveText("المحضر بانتظار الاعتماد");
  await meeting.getByRole("link", { name: "فتح المحضر" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(MINUTES);
  await expect(page.getByText("محضر اجتماع", { exact: true })).toBeVisible();
  await expect(page.getByTestId("linked-elements")).toContainText("DEMO-MED.1.2");
  const v1 = page.locator('li[data-version="1"]');
  await v1.getByRole("button", { name: "اعتماد" }).click();
  await expect(v1.getByTestId("version-state")).toHaveText("معتمدة وسارية");

  // The minutes are evidence for the overseen element.
  await page.goto("/ar/assessments");
  await page.getByLabel("النطاق").selectOption({ label: "المنشأة كاملة" });
  await page.getByRole("button", { name: "بدء التقييم" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تقييم ذاتي: المنشأة كاملة");
  const row = page.locator('li[data-element="DEMO-MED.1.2"]:visible');
  await row.locator("summary").click();
  await row.getByLabel("مستوفى", { exact: true }).check();
  await row.getByLabel("نوع الدليل").selectOption({ label: "وثيقة" });
  await row
    .getByLabel("وثيقة معتمدة من المكتبة")
    .selectOption({ label: `${MINUTES}، الإصدار 1 (مرتبطة بالعنصر)` });
  await row.getByRole("button", { name: "حفظ الدرجة" }).click();
  await expect(row.getByTestId("evidence-list")).toContainText(`${MINUTES}، الإصدار 1`);

  // Back on the committee, the minutes are approved and the meeting can no longer go.
  await page.goto("/ar/committees");
  const card = page.locator("li[data-committee]").filter({ hasText: COMMITTEE });
  await expect(card).toContainText("آخر اجتماع");
  await card.getByRole("link", { name: "فتح" }).click();
  await expect(meeting.getByTestId("minutes-status")).toHaveText("المحضر معتمد");
  await expect(meeting.getByRole("button", { name: "حذف الاجتماع" })).toHaveCount(0);

  // Delete: dissolving keeps the record but takes it off the list.
  await page.getByRole("button", { name: "حل اللجنة" }).click();
  await expect(page).toHaveURL(/\/ar\/committees$/);
  await expect(page.getByText("لا توجد لجان بعد.")).toBeVisible();
});

test("the committees screen reads in English", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/committees");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Committees");
  await expect(page.getByText("No committees yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create committee" })).toBeVisible();
});
