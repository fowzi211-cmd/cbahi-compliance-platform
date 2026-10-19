import AxeBuilder from "@axe-core/playwright";
import { expect, signUpOwner, test } from "./fixtures";

test("the root URL opens the Arabic sign-in page for visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar\/sign-in$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تسجيل الدخول");
});

for (const path of ["/ar/sign-in", "/en/sign-in", "/ar/sign-up"]) {
  test(`${path} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

// Everything below is the signed-in app shell.
test.describe("signed in", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signUpOwner(page, baseURL!);
  });

  test("the dashboard is Arabic and right-to-left", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("لوحة الجاهزية");
  });

  test("English pages are left-to-right", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Readiness dashboard");
  });

  test("switching language keeps the current page", async ({ page }) => {
    await page.goto("/ar/documents");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/documents$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documents");
    await page.getByRole("link", { name: "العربية" }).click();
    await expect(page).toHaveURL(/\/ar\/documents$/);
  });

  test("unknown pages show the localized not-found page", async ({ page }) => {
    // Pages are streamed (partial prerendering), so the HTTP status is sent before the page
    // knows it is missing; Next.js marks the page noindex instead of returning 404.
    await page.goto("/ar/no-such-page");
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الصفحة غير موجودة");
  });

  test.describe("desktop sidebar", () => {
    test.skip(({ isMobile }) => isMobile, "the sidebar is a drawer on phones");

    test("sits on the right in Arabic and on the left in English", async ({ page }) => {
      await page.goto("/ar");
      const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
      const main = page.locator("main");
      const [navBox, mainBox] = [await nav.boundingBox(), await main.boundingBox()];
      expect(navBox!.x).toBeGreaterThan(mainBox!.x);

      await page.goto("/en");
      const enNav = page.getByRole("navigation", { name: "Main navigation" });
      expect((await enNav.boundingBox())!.x).toBeLessThan(
        (await page.locator("main").boundingBox())!.x,
      );
    });

    test("marks the current page and navigates", async ({ page }) => {
      await page.goto("/ar");
      const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
      await nav.getByRole("link", { name: /مكتبة المعايير/ }).click();
      await expect(page).toHaveURL(/\/ar\/standards$/);
      await expect(nav.getByRole("link", { name: /مكتبة المعايير/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByText("تتوفر هذه الوحدة في المرحلة M4.")).toBeVisible();
    });
  });

  test.describe("mobile drawer", () => {
    test.skip(({ isMobile }) => !isMobile, "phones only");

    test("opens from the menu button and closes after navigating", async ({ page }) => {
      await page.goto("/ar");
      await page.getByRole("button", { name: "فتح القائمة" }).click();
      const drawer = page.getByRole("dialog", { name: "التنقل الرئيسي" });
      await expect(drawer).toBeVisible();
      await drawer.getByRole("link", { name: /الجولات التتبعية/ }).click();
      await expect(page).toHaveURL(/\/ar\/tracers$/);
      await expect(drawer).toBeHidden();
    });
  });

  for (const path of ["/ar", "/en", "/ar/standards", "/ar/people"]) {
    test(`${path} has no detectable accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
