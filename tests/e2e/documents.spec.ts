import AxeBuilder from "@axe-core/playwright";
import { makePdf } from "../../src/modules/documents/test-files";
import { expect, signUpOwner, test } from "./fixtures";

// ROADMAP M8 definition of done: upload → approve → link → cite in a score → new version.
// Needs the fictional demo framework (`pnpm db:seed`) and object storage (docker compose).
const DEMO_AR = "إطار الرعاية الإسعافية التجريبي";
const TITLE = "سياسة حفظ الأدوية التجريبية";
const pdf = (...lines: string[]) =>
  Buffer.from(makePdf([...lines, `Fictional ${Date.now()} ${Math.random()}`]));

test("a policy goes from upload to approval, is cited in a score and revised", async ({
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

  // Upload.
  await page.goto("/ar/documents");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الوثائق");
  await expect(page.getByText("لا توجد وثائق بعد.")).toBeVisible();
  const form = page.getByTestId("upload-document");
  await form.getByLabel("نوع الوثيقة").selectOption("policy");
  await form.getByLabel("العنوان بالعربية").fill(TITLE);
  await form.getByLabel("العنوان بالإنجليزية").fill("Demo medication storage policy");
  await form.getByLabel("الملف", { exact: true }).setInputFiles({
    name: "storage-policy.pdf",
    mimeType: "application/pdf",
    buffer: pdf("Demo medication storage policy", "Fridges are checked twice daily."),
  });
  await form.getByLabel("تاريخ السريان").fill("2026-01-01");
  await form.getByLabel("تاريخ المراجعة").fill("2028-01-01");
  await form.getByLabel(/أقرّ بأن هذا الملف لا يحتوي/).check();
  await form.getByRole("button", { name: "رفع الوثيقة" }).click();

  // Approve.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  const v1 = page.locator('li[data-version="1"]');
  await expect(v1.getByTestId("version-state")).toHaveText("بانتظار الاعتماد");
  await v1.getByRole("button", { name: "اعتماد" }).click();
  await expect(v1.getByTestId("version-state")).toHaveText("معتمدة وسارية");

  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);

  // The download link is minted on click and lasts five minutes.
  const href = (await v1.getByTestId("download").getAttribute("href"))!;
  const redirect = await page.request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(303);
  const signed = redirect.headers()["location"]!;
  expect(new URL(signed).searchParams.get("X-Amz-Expires")).toBe("300");
  const file = await page.request.get(signed);
  expect(file.ok()).toBe(true);
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Link it to an element.
  const select = page.getByLabel("العنصر");
  const value = await select.locator("option", { hasText: "DEMO-MED.1.2 " }).getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("button", { name: "ربط", exact: true }).click();
  await expect(page.getByTestId("linked-elements")).toContainText("DEMO-MED.1.2");

  // Cite it in a score.
  await page.goto("/ar/assessments");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("التقييم الذاتي");
  await page.getByLabel("النطاق").selectOption({ label: "المنشأة كاملة" });
  await page.getByRole("button", { name: "بدء التقييم" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تقييم ذاتي: المنشأة كاملة");
  const row = page.locator('li[data-element="DEMO-MED.1.2"]:visible');
  await row.locator("summary").click();
  await row.getByLabel("مستوفى", { exact: true }).check();
  await row.getByLabel("نوع الدليل").selectOption({ label: "وثيقة" });
  await row
    .getByLabel("وثيقة معتمدة من المكتبة")
    .selectOption({ label: `${TITLE}، الإصدار 1 (مرتبطة بالعنصر)` });
  await row.getByRole("button", { name: "حفظ الدرجة" }).click();
  await expect(row.getByTestId("evidence-list")).toContainText(`${TITLE}، الإصدار 1`);

  // A new version: the approved one stays in force until the new one is approved.
  await page.goto("/ar/documents");
  await page.locator("li[data-document]").filter({ hasText: TITLE }).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  const versionForm = page.getByTestId("upload-version");
  await versionForm.getByLabel("الملف", { exact: true }).setInputFiles({
    name: "storage-policy-v2.pdf",
    mimeType: "application/pdf",
    buffer: pdf("Demo medication storage policy, second issue"),
  });
  await versionForm.getByLabel("ما الذي تغيّر في هذا الإصدار").fill("أُضيف فحص نهاية الأسبوع.");
  await versionForm.getByLabel(/أقرّ بأن هذا الملف لا يحتوي/).check();
  await versionForm.getByRole("button", { name: "رفع الإصدار" }).click();
  await expect(versionForm.getByText("رُفع الإصدار، وهو بانتظار الاعتماد.")).toBeVisible();
  const v2 = page.locator('li[data-version="2"]');
  await expect(v2.getByTestId("version-state")).toHaveText("بانتظار الاعتماد");
  await expect(v1.getByTestId("version-state")).toHaveText("معتمدة وسارية");
  await v2.getByRole("button", { name: "اعتماد" }).click();
  await expect(v2.getByTestId("version-state")).toHaveText("معتمدة وسارية");
  await expect(v1.getByTestId("version-state")).toHaveText("استُبدلت بإصدار أحدث");
});

test("a file that looks like patient data is stopped before it is stored", async ({
  page,
  baseURL,
}) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/ar/documents");
  const form = page.getByTestId("upload-document");
  await form.getByLabel("العنوان بالعربية").fill("نموذج تجريبي");
  // Fictional values shaped like a medical record number and a date of birth.
  await form.getByLabel("الملف", { exact: true }).setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: pdf("Demo intake form", "MRN: 556677", "DOB: 01/02/1990"),
  });
  await form.getByLabel(/أقرّ بأن هذا الملف لا يحتوي/).check();
  await form.getByRole("button", { name: "رفع الوثيقة" }).click();
  await expect(form.getByRole("alert")).toHaveText(
    "يبدو أن الملف يحتوي على بيانات مرضى، فلم يُحفظ.",
  );
  await expect(form.getByLabel(/راجعت الملف وأؤكد/)).toBeVisible();
  await expect(page.getByText("لا توجد وثائق بعد.")).toBeVisible();
});

test("the documents screen reads in English", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/documents");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documents");
  await expect(page.getByText("No documents yet.")).toBeVisible();
});
