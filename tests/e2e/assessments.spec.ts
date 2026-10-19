import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  PASSWORD,
  signUpOwner,
  test,
  totpCode,
  uniqueEmail,
  waitForEmail,
} from "./fixtures";

// ROADMAP M7 definition of done: a quality manager completes a department assessment,
// readiness updates and findings are created. Needs the fictional demo framework
// (`pnpm db:seed`), in which seven elements belong to pharmacy, two of them ESR.
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

test("a quality manager completes a pharmacy assessment", async ({
  page,
  baseURL,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  await signUpOwner(page, baseURL!);

  // The owner uses the demo framework and adds a pharmacy.
  await page.goto("/ar/onboarding/frameworks");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأطر");
  for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
  await page.locator("label").filter({ hasText: DEMO_AR }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();
  await expect(page).toHaveURL(/\/ar\/onboarding\/applicability$/);
  await page.goto("/ar/onboarding/departments");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأقسام");
  await page.getByLabel("اسم القسم بالعربية").fill("الصيدلية");
  await page.getByLabel("اسم القسم بالإنجليزية").fill("Pharmacy");
  await page.getByLabel("نوع القسم").selectOption("pharmacy");
  await page.getByRole("button", { name: "إضافة القسم" }).click();
  await expect(page.getByTestId("department-list")).toContainText("الصيدلية");

  // Before any assessment, the dashboard has nothing verified.
  await page.goto("/ar");
  await expect(page.getByTestId("readiness-status")).toHaveText("غير جاهز");
  const coverage = page.getByTestId("readiness-coverage");
  await expect(coverage).toHaveText(/^العناصر ذات درجة سارية: 0 من \d+$/);
  const applicable = (await coverage.textContent())!.split(" ").pop();

  // The owner invites a quality manager.
  const qmEmail = uniqueEmail("qm");
  await page.goto("/ar/people");
  await page.getByLabel("البريد الإلكتروني").fill(qmEmail);
  await page.getByLabel("الدور").selectOption("quality_manager");
  await page.getByRole("button", { name: "إرسال الدعوة" }).click();
  await expect(page.getByText("أُرسلت الدعوة.")).toBeVisible();
  const email = await waitForEmail(request, qmEmail);
  const invitePath = new URL(email.Text.match(/https?:\/\/\S+\/ar\/invite\/[A-Za-z0-9_-]+/)![0])
    .pathname;

  // The quality manager joins and, like every manager, turns on a second factor.
  const context = await browser.newContext({
    baseURL,
    locale: "ar-SA",
    extraHTTPHeaders: { "x-forwarded-for": `10.201.${Math.floor(Math.random() * 250)}.7` },
  });
  const qm = await context.newPage();
  await qm.goto(invitePath);
  await qm.getByRole("link", { name: "أنشئ حسابًا واقبل الدعوة" }).click();
  await qm.getByLabel("الاسم الكامل").fill("ريم مديرة الجودة");
  await qm.getByLabel("كلمة المرور").fill(PASSWORD);
  await qm.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(qm).toHaveURL(new RegExp(`${invitePath}$`));
  await qm.getByRole("button", { name: "قبول الدعوة" }).click();
  await expect(qm).toHaveURL(/\/ar\/mfa$/);
  await qm.getByLabel("أكّد كلمة المرور").fill(PASSWORD);
  await qm.getByRole("button", { name: "متابعة" }).click();
  const secret = (await qm.getByTestId("totp-secret").textContent())!.trim();
  await qm.getByLabel("أدخل الرمز المكوّن من 6 أرقام من التطبيق").fill(totpCode(secret));
  await qm.getByRole("button", { name: "تفعيل التحقق بخطوتين" }).click();
  await expect(qm.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");

  // Start a pharmacy assessment.
  await qm.getByRole("link", { name: "التقييم الذاتي" }).first().click();
  await expect(qm.getByRole("heading", { level: 1 })).toHaveText("التقييم الذاتي");
  await qm.getByLabel("النطاق").selectOption({ label: "الصيدلية" });
  await qm.getByRole("button", { name: "بدء التقييم" }).click();
  await expect(qm.getByRole("heading", { level: 1 })).toHaveText("تقييم ذاتي: الصيدلية");
  const rows = qm.locator("li[data-element]:visible");
  await expect(rows).toHaveCount(PHARMACY.length);
  await expect(qm.getByTestId("assessment-progress")).toHaveText("التقدم: 0 من 7");

  const row = (code: string) => qm.locator(`li[data-element="${code}"]:visible`);
  async function score(
    code: string,
    level: string,
    extra: { comment?: string; kind?: string; note?: string; url?: string } = {},
  ) {
    const el = row(code);
    const details = el.locator("details");
    if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
      await el.locator("summary").click();
    }
    await el.getByLabel(level, { exact: true }).check();
    if (extra.comment) await el.getByLabel("التعليق").fill(extra.comment);
    if (extra.kind) await el.getByLabel("نوع الدليل").selectOption({ label: extra.kind });
    if (extra.note) await el.getByLabel("وصف الدليل").fill(extra.note);
    if (extra.url) await el.getByLabel("رابط الوثيقة").fill(extra.url);
    await el.getByRole("button", { name: "حفظ الدرجة" }).click();
  }

  // Met without evidence is refused (anti-decoration), and an ESR element cannot be partial.
  await score("DEMO-MED.1.2", "مستوفى");
  await expect(row("DEMO-MED.1.2").getByRole("alert")).toHaveText(
    "هذه الدرجة تحتاج إلى دليل واحد على الأقل.",
  );
  await expect(row("DEMO-MED.1.1").getByLabel("مستوفى جزئيًا", { exact: true })).toBeDisabled();

  const observation = { kind: "ملاحظة ميدانية", note: "شوهد التطبيق في نوبتين." };
  await score("DEMO-MED.1.1", "مستوفى", observation);
  await expect(row("DEMO-MED.1.1").getByTestId("element-level")).toHaveText("مستوفى");
  await score("DEMO-MED.1.2", "مستوفى", observation);
  await score("DEMO-MED.1.3", "مستوفى", { kind: "مراجعة سجل", note: "سجل الشهر مكتمل." });
  await score("DEMO-MED.1.4", "مستوفى جزئيًا", {
    comment: "السياسة موجودة لكنها لم تُراجع.",
    kind: "وثيقة",
    url: "https://dms.example.test/policies/demo-7",
  });
  await score("DEMO-MED.2.1", "غير مستوفى", { comment: "لا توجد قائمة تحقق في القسم." });
  await score("DEMO-MED.2.2", "مستوفى", { kind: "مقابلة", note: "شرح الصيدلي الإجراء." });
  await score("DEMO-MED.2.3", "مستوفى", { kind: "مؤشر أداء", note: "الالتزام 96٪ هذا الشهر." });
  await expect(qm.getByTestId("assessment-progress")).toHaveText("التقدم: 7 من 7");
  await expect(row("DEMO-MED.1.4").getByTestId("evidence-list")).toContainText(
    "https://dms.example.test/policies/demo-7",
  );

  const a11y = await new AxeBuilder({ page: qm })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);

  // Submit: the assessment locks and raises one finding per gap.
  await qm.getByRole("button", { name: "إرسال وإقفال" }).click();
  await expect(qm.getByTestId("assessment-status").first()).toHaveText("مُرسل ومقفل");
  const findings = qm.getByTestId("assessment-findings");
  await expect(findings.locator("li[data-finding]")).toHaveCount(2);
  await expect(findings.locator('li[data-finding="DEMO-MED.1.4"]')).toContainText("متوسطة");
  await expect(findings.locator('li[data-finding="DEMO-MED.2.1"]')).toContainText("عالية");
  await expect(qm.getByTestId("score-form")).toHaveCount(0);

  // Readiness now counts the seven verified elements; ESR elements elsewhere are still
  // unverified, so the facility is not ready yet.
  await qm.goto("/ar");
  await expect(qm.getByTestId("readiness-coverage")).toHaveText(
    `العناصر ذات درجة سارية: 7 من ${applicable}`,
  );
  await expect(qm.getByTestId("readiness-status")).toHaveText("غير جاهز");
  await context.close();
});

test("the assessment screens read in English", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/assessments");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Self-assessment");
  await expect(page.getByText("No assessments yet.")).toBeVisible();
});
