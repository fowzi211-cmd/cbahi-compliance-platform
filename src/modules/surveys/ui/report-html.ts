import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPercent } from "@/lib/numbers";
import type { ReportLocale, ReportSummary } from "../domain/report";

// The printed findings report of a mock survey, as one self-contained HTML page (fonts
// inlined, no scripts, no external requests) that lib/pdf prints to A4. Every value is
// escaped: comments and titles come from people and imported frameworks.

/** A translator for the `surveys.report` messages. */
export type ReportTranslator = (key: string, values?: Record<string, string | number>) => string;

export type ReportMeta = {
  facilityNameAr: string | null;
  facilityNameEn: string | null;
  frameworkNameAr: string | null;
  frameworkNameEn: string | null;
  frameworkCode: string;
  frameworkEdition: string;
  source: "internal" | "consultant";
  surveyorName: string | null;
  startedAt: Date;
  submittedAt: Date;
  printedAt: Date;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The text in the report's language, else the other one (a framework may lack a translation). */
const pick = (locale: ReportLocale, ar: string | null, en: string | null) =>
  (locale === "ar" ? ar || en : en || ar) || "";

const code = (value: string) => `<bdi dir="ltr" class="code">${escapeHtml(value)}</bdi>`;
const text = (value: string | null | undefined) =>
  value ? `<span dir="auto">${escapeHtml(value)}</span>` : "";
const multiline = (value: string | null | undefined) =>
  value ? `<div dir="auto" class="pre">${escapeHtml(value)}</div>` : "";

const styles = `
@page { size: A4; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Report", "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif;
  font-size: 10pt; line-height: 1.55; color: #111827; background: #ffffff; }
h1 { font-size: 18pt; margin: 0 0 2mm; line-height: 1.3; }
h2 { font-size: 12.5pt; margin: 7mm 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 1.5px solid #0f766e;
  color: #0f766e; break-after: avoid; }
.subtitle { font-size: 11pt; color: #374151; margin: 0 0 5mm; }
.code { font-family: "Report", ui-monospace, monospace; white-space: nowrap; }
.pre { white-space: pre-line; }
.muted { color: #4b5563; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: start; vertical-align: top; padding: 1.6mm 2mm; border-bottom: 1px solid #e5e7eb; }
th { background: #f3f4f6; font-weight: 700; font-size: 9pt; color: #374151; }
tr { break-inside: avoid; }
.meta th { width: 32%; background: transparent; color: #4b5563; font-weight: 400; }
.meta td { font-weight: 700; }
.notice { margin: 5mm 0; padding: 3mm 4mm; border: 1px solid #d1d5db; border-radius: 2mm;
  background: #f9fafb; color: #374151; font-size: 9pt; }
.cards { display: flex; gap: 3mm; margin: 2mm 0 3mm; }
.card { flex: 1; border: 1px solid #e5e7eb; border-radius: 2mm; padding: 3mm; }
.card .label { font-size: 8.5pt; color: #4b5563; }
.card .value { font-size: 15pt; font-weight: 700; }
.verdict { display: inline-block; padding: 0.8mm 3mm; border-radius: 99px; font-weight: 700; }
.verdict.ready { background: #dcfce7; color: #166534; }
.verdict.at_risk { background: #fef3c7; color: #92400e; }
.verdict.not_ready { background: #fee2e2; color: #991b1b; }
.sev { display: inline-block; padding: 0.3mm 2mm; border-radius: 99px; font-size: 8.5pt; font-weight: 700;
  white-space: nowrap; }
.sev.esr { background: #fee2e2; color: #991b1b; }
.sev.high { background: #ffedd5; color: #9a3412; }
.sev.medium { background: #fef3c7; color: #92400e; }
.sev.low { background: #e5e7eb; color: #374151; }
.num { text-align: end; white-space: nowrap; }
ul { margin: 1mm 0; padding-inline-start: 5mm; }
`;

/** The report page and its footer, in one language. */
export function renderReportHtml(input: {
  locale: ReportLocale;
  t: ReportTranslator;
  meta: ReportMeta;
  summary: ReportSummary;
  levels: readonly { code: string; labelAr: string | null; labelEn: string | null }[];
  fontCss: string;
}): { html: string; footerHtml: string } {
  const { locale, t, meta, summary } = input;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const facility = pick(locale, meta.facilityNameAr, meta.facilityNameEn);
  const framework = pick(locale, meta.frameworkNameAr, meta.frameworkNameEn) || meta.frameworkCode;
  const levelLabel = new Map(
    input.levels.map((l) => [l.code, pick(locale, l.labelAr, l.labelEn) || l.code]),
  );
  const level = (value: string) => escapeHtml(levelLabel.get(value) ?? value);
  const percent = (value: number | null) =>
    value === null ? escapeHtml(t("noScore")) : `<bdi dir="ltr">${formatPercent(value)}</bdi>`;
  const date = (value: Date) => escapeHtml(formatDate(value, locale, { style: "long" }));

  const metaRows: [string, string][] = [
    [t("meta.facility"), text(facility)],
    [
      t("meta.framework"),
      `${text(framework)} · ${code(`${meta.frameworkCode} ${meta.frameworkEdition}`)}`,
    ],
    [t("meta.kind"), escapeHtml(t(`kinds.${meta.source}`))],
    [t("meta.surveyor"), meta.surveyorName ? text(meta.surveyorName) : "—"],
    [t("meta.started"), date(meta.startedAt)],
    [t("meta.locked"), date(meta.submittedAt)],
    [t("meta.printed"), escapeHtml(formatDateTime(meta.printedAt, locale))],
  ];

  const findingRows = summary.findings
    .map(
      (f) => `<tr>
        <td><span class="sev ${f.severity}">${escapeHtml(t(`severity.${f.severity}`))}</span></td>
        <td>${code(f.elementCode)}<div>${text(pick(locale, f.titleAr, f.titleEn))}</div></td>
        <td>${level(f.levelCode)}</td>
        <td>${multiline(f.statement) || `<span class="muted">${escapeHtml(t("findings.noStatement"))}</span>`}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t("title"))}</title>
<style>${input.fontCss}
${styles}</style>
</head>
<body>
<h1>${escapeHtml(t("title"))}</h1>
<p class="subtitle">${text(facility)}</p>
<table class="meta"><tbody>
${metaRows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${value}</td></tr>`).join("")}
</tbody></table>
<div class="notice">${escapeHtml(t(`notice.${meta.source}`))}</div>

<h2>${escapeHtml(t("summary.heading"))}</h2>
<div class="cards">
  <div class="card"><div class="label">${escapeHtml(t("summary.verdict"))}</div>
    <div class="value"><span class="verdict ${summary.verdict}">${escapeHtml(t(`verdicts.${summary.verdict}`))}</span></div></div>
  <div class="card"><div class="label">${escapeHtml(t("summary.score"))}</div><div class="value">${percent(summary.score)}</div></div>
  <div class="card"><div class="label">${escapeHtml(t("summary.findings"))}</div><div class="value"><bdi dir="ltr">${summary.findings.length}</bdi></div></div>
  <div class="card"><div class="label">${escapeHtml(t("summary.esrNotMet"))}</div><div class="value"><bdi dir="ltr">${summary.esrNotMet.length}</bdi></div></div>
</div>
${
  summary.reasons.length > 0
    ? `<ul>${summary.reasons.map((r) => `<li>${escapeHtml(t(`reasons.${r}`, { threshold: `\u2066${formatPercent(summary.readyScore)}\u2069`, minimum: `\u2066${formatPercent(summary.minStandardScore ?? 0)}\u2069` }))}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(t("reasons.none"))}</p>`
}
${
  summary.esrNotMet.length > 0
    ? `<p><strong>${escapeHtml(t("summary.esrList"))}</strong> ${summary.esrNotMet.map(code).join(" · ")}</p>`
    : ""
}
<table>
<thead><tr><th>${escapeHtml(t("levels.level"))}</th><th class="num">${escapeHtml(t("levels.count"))}</th></tr></thead>
<tbody>
${summary.levelCounts.map((l) => `<tr><td>${level(l.code)}</td><td class="num"><bdi dir="ltr">${l.count}</bdi></td></tr>`).join("")}
<tr><td><strong>${escapeHtml(t("levels.total"))}</strong></td><td class="num"><strong><bdi dir="ltr">${summary.elementsScored}</bdi></strong></td></tr>
</tbody>
</table>

<h2>${escapeHtml(t("chapters.heading"))}</h2>
<table>
<thead><tr><th>${escapeHtml(t("chapters.chapter"))}</th><th class="num">${escapeHtml(t("chapters.score"))}</th></tr></thead>
<tbody>
${summary.chapters
  .map(
    (c) =>
      `<tr><td>${code(c.code)} ${text(pick(locale, c.titleAr, c.titleEn))}</td><td class="num">${percent(c.score)}</td></tr>`,
  )
  .join("")}
</tbody>
</table>

<h2>${escapeHtml(t("findings.heading"))}</h2>
${
  summary.findings.length === 0
    ? `<p>${escapeHtml(t("findings.none"))}</p>`
    : `<table>
<thead><tr><th>${escapeHtml(t("findings.severity"))}</th><th>${escapeHtml(t("findings.element"))}</th><th>${escapeHtml(t("findings.level"))}</th><th>${escapeHtml(t("findings.statement"))}</th></tr></thead>
<tbody>${findingRows}</tbody>
</table>`
}

<h2>${escapeHtml(t("elements.heading"))}</h2>
<table>
<thead><tr><th>${escapeHtml(t("elements.element"))}</th><th>${escapeHtml(t("elements.level"))}</th></tr></thead>
<tbody>
${summary.elements
  .map(
    (e) =>
      `<tr><td>${code(e.code)}${e.isEsr ? ` <span class="sev esr">${escapeHtml(t("severity.esr"))}</span>` : ""}<div>${text(pick(locale, e.titleAr, e.titleEn))}</div></td><td>${level(e.levelCode)}</td></tr>`,
  )
  .join("")}
</tbody>
</table>
</body>
</html>`;

  // Chromium prints the footer in its own context: it needs its own font and direction.
  const footerHtml = `<style>${input.fontCss}</style><div dir="${dir}" style="font-family:Report,Tahoma,Arial,sans-serif;font-size:7.5pt;color:#6b7280;width:100%;padding:0 14mm;display:flex;justify-content:space-between;"><span>${escapeHtml(t("footer", { facility }))}</span><span dir="ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

  return { html, footerHtml };
}
