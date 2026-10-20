import { expect, test } from "@playwright/test";
import { pdfFontCss } from "@/lib/pdf";
import { reportLocales } from "@/modules/surveys/domain/report";
import { renderReportHtml } from "@/modules/surveys/ui/report-html";
import { reportTranslator } from "@/modules/surveys/ui/report-messages";
import { fixtureLevels, fixtureMeta, fixtureSummary } from "./report-fixture";

// ROADMAP M15 definition of done: a visual snapshot of the findings report. The template is
// rendered from a fixed, fictional survey at A4 width, in print media, exactly as the PDF
// renderer receives it. Run with --update-snapshots after an intended layout change.

// The report has one layout; phones add nothing here.
test.skip(({ isMobile }) => isMobile, "desktop only");

for (const locale of reportLocales) {
  test(`the ${locale} report matches its snapshot`, async ({ page }) => {
    const { html } = renderReportHtml({
      locale,
      t: reportTranslator(locale),
      meta: fixtureMeta,
      summary: fixtureSummary,
      levels: fixtureLevels,
      fontCss: await pdfFontCss(),
    });
    // A4 at 96 dpi less the PDF margins (14 mm each side).
    await page.setViewportSize({ width: 688, height: 1000 });
    await page.emulateMedia({ media: "print" });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`mock-survey-report-${locale}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
