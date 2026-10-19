import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext } from "@playwright/test";
import { makePdf } from "../../src/modules/documents/test-files";
import { expect, signUpOwner, test } from "./fixtures";

// ROADMAP M10 definition of done: Mailpit receives Arabic and English emails, and the in-app
// inbox works. The jobs run once through `pnpm jobs:run` with a fake clock (`--now`), the
// same entry point operations use, instead of waiting for the worker's schedule.
const TITLE_AR = "سياسة تجريبية للتذكير";
const TITLE_EN = "Demo reminder policy";
const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
// Mid-morning in Riyadh, `offset` days from now.
const at = (offset: number) => `${isoDay(offset)}T07:00:00Z`;

function runJobs(now: string, ...jobs: string[]) {
  execFileSync("pnpm", ["--silent", "jobs:run", ...jobs, "--now", now], { stdio: "pipe" });
}

async function waitForSubject(request: APIRequestContext, to: string, subject: string) {
  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await request.get(`${mailpit}/api/v1/search`, {
      params: { query: `to:"${to}" subject:"${subject}"` },
    });
    const { messages } = (await search.json()) as { messages?: { ID: string }[] };
    if (messages?.length) {
      const message = await request.get(`${mailpit}/api/v1/message/${messages[0]!.ID}`);
      return (await message.json()) as { Subject: string; Text: string; HTML: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email "${subject}" to ${to}`);
}

test("document reminders reach the inbox and email, in Arabic then English", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(150_000);
  const owner = await signUpOwner(page, baseURL!);

  // An approved policy, due for review in 5 days and expiring in 20.
  await page.goto("/ar/documents");
  const form = page.getByTestId("upload-document");
  await form.getByLabel("نوع الوثيقة").selectOption("policy");
  await form.getByLabel("العنوان بالعربية").fill(TITLE_AR);
  await form.getByLabel("العنوان بالإنجليزية").fill(TITLE_EN);
  await form.getByLabel("الملف", { exact: true }).setInputFiles({
    name: "reminder-policy.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(makePdf([TITLE_EN, `Fictional ${Date.now()} ${Math.random()}`])),
  });
  await form.getByLabel("تاريخ السريان").fill(isoDay(-60));
  await form.getByLabel("تاريخ المراجعة").fill(isoDay(5));
  await form.getByLabel("تاريخ الانتهاء").fill(isoDay(20));
  await form.getByLabel(/أقرّ بأن هذا الملف لا يحتوي/).check();
  await form.getByRole("button", { name: "رفع الوثيقة" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE_AR);
  await page.getByRole("button", { name: "اعتماد" }).click();
  await expect(page.getByTestId("version-state")).toHaveText("معتمدة وسارية");
  const documentUrl = page.url();

  // Six days on: review is due and expiry is near. Both arrive in one Arabic digest.
  runJobs(at(6), "reminders", "deliver", "digest");
  const digest = await waitForSubject(request, owner.email, "ملخصك اليومي");
  expect(digest.Subject).toBe("ملخصك اليومي: تحديثان");
  expect(digest.Text).toContain(`حان موعد المراجعة: ${TITLE_AR}`);
  expect(digest.HTML).toContain('dir="rtl"');

  // The inbox and the bell.
  await page.goto("/ar");
  const bell = page.getByTestId("notification-bell");
  await expect(bell.getByTestId("notification-count")).toHaveText("2");
  await bell.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("التنبيهات");
  const inbox = page.getByTestId("inbox");
  await expect(inbox.locator('li[data-read="false"]')).toHaveCount(2);
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await inbox
    .locator('li[data-type="documentReviewDue"]')
    .getByRole("button", { name: "فتح" })
    .click();
  await expect(page).toHaveURL(documentUrl);
  await expect(bell.getByTestId("notification-count")).toHaveText("1");

  // Emails in English from now on.
  await page.goto("/ar/notifications");
  const prefs = page.getByTestId("notification-prefs");
  await prefs.getByLabel("لغة البريد").selectOption("en");
  await prefs.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await expect(prefs.getByText("حُفظت الإعدادات.")).toBeVisible();

  // Past the expiry date: an urgent notice, emailed at once, in English.
  runJobs(at(21), "reminders", "deliver");
  const expired = await waitForSubject(request, owner.email, "Expired");
  expect(expired.Subject).toBe(`Expired: ${TITLE_EN}`);
  expect(expired.HTML).toContain('dir="ltr"');
  expect(expired.Text).toContain(`/en/documents/`);
});

test("the inbox reads in English", async ({ page, baseURL }) => {
  await signUpOwner(page, baseURL!);
  await page.goto("/en/notifications");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notifications");
  await expect(page.getByText("No notifications yet.")).toBeVisible();
  await expect(page.getByTestId("notification-bell")).toHaveAccessibleName(
    "No unread notifications",
  );
});
