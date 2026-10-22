import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { extractText } from "unpdf";
import { expect, expectAccessible, test, totpCode } from "./fixtures";

// ROADMAP M17: final acceptance on the seeded demo tenant (brief §11). `pnpm db:seed` creates
// «مستوصف النور التجريبي» with six months of history and writes the people's sign-in details
// to .demo-credentials.json. These tests read the history and add nothing that would change
// what the others check, so they run in any order. docs/ACCEPTANCE.md maps every §11 item
// to the tests that demonstrate it, here and in the journey specs of earlier milestones.

type Person =
  | "owner"
  | "quality"
  | "nursingHead"
  | "pharmacyHead"
  | "infectionHead"
  | "staff"
  | "viewer"
  | "consultant"
  | "platformAdmin";
type Credentials = {
  password: string;
  facility: { nameAr: string; nameEn: string };
  people: Record<Person, { email: string; name: string; totpSecret: string | null }>;
};

const demo = JSON.parse(
  readFileSync(path.join(process.cwd(), ".demo-credentials.json"), "utf8"),
) as Credentials;

/** Signs in through the sign-in screen, with the authenticator code when the person has one. */
async function signIn(page: Page, person: Person) {
  const { email, totpSecret } = demo.people[person];
  await page.goto("/ar/sign-in");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(demo.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  if (totpSecret) {
    await expect(page).toHaveURL(/\/ar\/sign-in\/verify/);
    await page.getByLabel("رمز التحقق").fill(totpCode(totpSecret));
    await page.getByRole("button", { name: "تحقّق" }).click();
  }
  await expect(page).not.toHaveURL(/sign-in/);
}

/** The facility's name in the visible page header. */
const facilityName = (page: Page, name: string) =>
  page.locator("header:visible").filter({ hasText: name }).first();

/** The trend table's internal scores, oldest first. */
async function internalTrend(page: Page) {
  const trend = page.getByTestId("trend");
  await trend.locator("summary").click();
  const cells = await trend.locator("tbody tr td:nth-child(2)").allTextContents();
  return cells.reverse().map((cell) => Number(cell.replace(/[^\d.]/g, "")));
}

test.describe("the demo polyclinic", () => {
  test("the quality manager reads six months of readiness on the dashboard", async ({ page }) => {
    await signIn(page, "quality");

    await page.goto("/ar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");
    await expect(facilityName(page, demo.facility.nameAr)).toBeVisible();
    // An ESR element lapsed a week ago: not ready, whatever the score says.
    await expect(page.getByTestId("readiness-status")).toHaveText("غير جاهز");
    await expect(page.getByTestId("esr-panel")).toContainText("DEMO-INF.2.1");
    for (const department of ["الإدارة", "التمريض", "الصيدلية", "مكافحة العدوى"]) {
      await expect(page.getByTestId("department-scores")).toContainText(department);
    }
    await expect(page.getByTestId("chapter-scores").locator("li")).toHaveCount(8);
    await expect(page.getByTestId("capa-overdue")).toHaveText("المتأخرة: 1");
    await expect(page.getByTestId("survey-days")).toHaveText("75");

    // The trend: about six months of nightly points, a climb, a dip in the summer and a
    // recovery, with the consultant's series alongside since the mock survey.
    const trend = page.getByTestId("trend");
    await expect(trend.getByRole("img")).toBeVisible();
    await expect(trend.locator("thead")).toContainText("المستشار");
    const scores = await internalTrend(page);
    expect(scores.length).toBeGreaterThanOrEqual(170);
    const peak = scores.indexOf(Math.max(...scores.slice(0, 110)));
    const low = Math.min(...scores.slice(peak));
    expect(scores[0]).toBeLessThan(70);
    expect(scores[peak]).toBeGreaterThan(95);
    expect(low).toBeLessThan(scores[peak]! - 8);
    expect(scores.at(-1)).toBeGreaterThan(low + 8);
    await expectAccessible(page);

    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Readiness dashboard");
    await expect(facilityName(page, demo.facility.nameEn)).toBeVisible();
    await expect(page.getByTestId("readiness-status")).toHaveText("Not ready");
    await expect(page.getByTestId("not-ready-banner")).toContainText("Not ready for survey");
    await expect(page.getByTestId("survey-countdown")).toContainText("75 days left");
    await expect(page.getByTestId("trend").locator("thead")).toContainText("Consultant");
    expect((await internalTrend(page)).length).toBe(scores.length);
    await expectAccessible(page);
  });

  test("the history is on record: assessments, tracers, actions and documents", async ({
    page,
  }) => {
    await signIn(page, "quality");

    // Three whole-facility self-assessments and one of nursing, all locked.
    await page.goto("/ar/assessments");
    const assessments = page.getByTestId("assessment-list").locator("li");
    await expect(assessments).toHaveCount(4);
    await expect(assessments.getByTestId("assessment-status")).toHaveText(
      Array(4).fill("مُرسل ومقفل"),
    );

    // Four tracer templates, walked every week or month.
    await page.goto("/ar/tracers");
    await expect(page.locator("li[data-template]")).toHaveCount(4);
    expect(await page.getByTestId("tracer-runs").locator("li[data-run]").count()).toBeGreaterThan(
      40,
    );

    // Most findings were fixed and verified; one action is overdue, one under way.
    await page.goto("/ar/findings");
    expect(await page.locator("li[data-finding]").count()).toBeGreaterThan(80);
    await page.goto("/ar/findings?status=verified");
    expect(await page.locator("li[data-finding]").count()).toBeGreaterThan(80);
    await page.goto("/ar/findings?status=in_progress");
    await expect(page.locator("li[data-finding]").first()).toBeVisible();

    // Documents, one of them in its second version and one waiting for approval.
    await page.goto("/ar/documents");
    const main = page.getByRole("main");
    await expect(main).toContainText("إجراء صرف الأدوية عالية الخطورة");
    await expect(main).toContainText("إجراء مواعيد العيادات الخارجية");
    await expect(main).toContainText("تقرير المسح التجريبي");
    await expectAccessible(page);

    await page.goto("/en/documents");
    await expect(page.getByRole("main")).toContainText("High-alert medicines dispensing procedure");
    await page.goto("/en/assessments");
    await expect(page.getByTestId("assessment-list").locator("li")).toHaveCount(4);
  });

  test("the consultant opens the mock survey and downloads its findings report", async ({
    page,
  }) => {
    await signIn(page, "consultant");
    await page.goto("/ar/mock-surveys");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("المسح التجريبي");
    await page.getByTestId("mock-survey-list").getByRole("link").first().click();
    const report = page.getByTestId("mock-survey-report");
    await expect(report.locator("a[data-report]")).toHaveCount(2);
    const href = (await report.locator('a[data-report="en"]').getAttribute("href"))!;
    const redirect = await page.request.get(href, { maxRedirects: 0 });
    expect(redirect.status()).toBe(303);
    const file = await page.request.get(redirect.headers()["location"]!);
    expect(file.headers()["content-type"]).toBe("application/pdf");
    const { text } = await extractText(new Uint8Array(await file.body()), { mergePages: true });
    expect(text).toContain("Mock survey findings report");
    expect(text).toContain(demo.facility.nameEn);
    await expectAccessible(page);
  });

  test("every role signs in to the polyclinic", async ({ page }) => {
    for (const person of ["owner", "nursingHead", "pharmacyHead", "staff", "viewer"] as const) {
      await page.context().clearCookies();
      await signIn(page, person);
      await page.goto("/ar");
      await expect(facilityName(page, demo.facility.nameAr)).toBeVisible();
    }
  });

  test("the quality manager walks a pharmacy tracer on a phone", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Tracers are walked on phones; the mobile project runs this one.");
    await signIn(page, "quality");
    await page.goto("/ar/tracers");
    const card = page.locator("li[data-template]").filter({ hasText: "جولة الصيدلية الأسبوعية" });
    // A run left open by an interrupted earlier attempt is continued, not restarted.
    const open = card.getByRole("link", { name: "متابعة الجولة" });
    if (await open.count()) await open.click();
    else await card.getByRole("button", { name: "بدء جولة" }).click();
    await expect(page).toHaveURL(/\/ar\/tracers\/runs\/[0-9a-f-]+/);

    // One element per screen, as many as the template draws.
    const step = page.getByTestId("tracer-step");
    await expect(step).toHaveText(/^العنصر 1 من \d+$/);
    const total = Number((await step.textContent())!.match(/\d+$/)![0]);
    for (let n = 1; n <= total; n++) {
      await expect(step).toHaveText(`العنصر ${n} من ${total}`);
      const form = page.getByTestId("tracer-step-form");
      await form.getByLabel("مستوفى", { exact: true }).check();
      await form.getByLabel("طريقة التحقق").selectOption({ label: "ملاحظة ميدانية" });
      await form.getByLabel("ما الذي رأيته أو سمعته").fill("شوهد التحقق المزدوج قبل الصرف.");
      await form
        .getByRole("button", { name: n === total ? "حفظ والمراجعة" : "حفظ والتالي" })
        .click();
    }
    await expect(page.getByRole("heading", { name: "المراجعة والإرسال" })).toBeVisible();
    await page.getByRole("button", { name: "إرسال الجولة" }).click();
    await expect(page.getByRole("heading", { name: "أُرسلت الجولة" })).toBeVisible();
    await expectAccessible(page);
  });
});
