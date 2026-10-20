import { reportSummary } from "@/modules/surveys/domain/report";
import type { ReportMeta } from "@/modules/surveys/ui/report-html";

// A fixed, fictional mock survey for the report's visual snapshot: DEMO content only, fixed
// dates, so the printed page is the same on every run.

export const fixtureLevels = [
  { code: "MET", labelAr: "مستوفى", labelEn: "Met" },
  { code: "PM", labelAr: "مستوفى جزئيًا", labelEn: "Partially met" },
  { code: "NM", labelAr: "غير مستوفى", labelEn: "Not met" },
  { code: "NA", labelAr: "لا ينطبق", labelEn: "Not applicable" },
];

export const fixtureMeta: ReportMeta = {
  facilityNameAr: "مستوصف النور التجريبي",
  facilityNameEn: "Al-Noor Demo Polyclinic",
  frameworkNameAr: "معيار تجريبي للرعاية الإسعافية",
  frameworkNameEn: "Demo ambulatory framework",
  frameworkCode: "DEMO-AMB",
  frameworkEdition: "2026",
  source: "consultant",
  surveyorName: "سارة المستشارة",
  startedAt: new Date("2026-10-18T06:00:00Z"),
  submittedAt: new Date("2026-10-19T12:30:00Z"),
  printedAt: new Date("2026-10-20T09:15:00Z"),
};

const element = (
  code: string,
  titleAr: string,
  titleEn: string,
  levelCode: string,
  isEsr = false,
  comment: string | null = null,
) => ({
  code,
  titleAr,
  titleEn,
  chapterCode: code.split(".")[0]!,
  isEsr,
  levelCode,
  fullyMet: levelCode === "MET",
  notApplicable: levelCode === "NA",
  comment,
});

export const fixtureSummary = reportSummary({
  score: 0.68,
  scale: fixtureLevels,
  chapters: [
    {
      code: "DEMO-MED",
      titleAr: "إدارة الأدوية (تجريبي)",
      titleEn: "Medication management (demo)",
      score: 0.5,
      counted: 3,
    },
    {
      code: "DEMO-GOV",
      titleAr: "الحوكمة والقيادة (تجريبي)",
      titleEn: "Governance and leadership (demo)",
      score: 0.875,
      counted: 2,
    },
  ],
  elements: [
    element(
      "DEMO-MED.1.1",
      "تخزين الأدوية عالية الخطورة بشكل منفصل",
      "High-alert medicines are stored apart",
      "NM",
      true,
      "وُجدت أدوية عالية الخطورة على الرف العام في غرفة العلاج.",
    ),
    element(
      "DEMO-MED.1.2",
      "توثيق درجات حرارة الثلاجة يوميًا",
      "Fridge temperatures are logged daily",
      "PM",
      false,
      "السجل ناقص لثلاثة أيام من الأسبوع الماضي.",
    ),
    element(
      "DEMO-MED.2.1",
      "مراجعة الصيدلي لكل وصفة جديدة",
      "A pharmacist reviews every new prescription",
      "MET",
    ),
    element(
      "DEMO-GOV.1.1",
      "خطة سنوية معتمدة لتحسين الجودة",
      "An approved annual quality plan",
      "MET",
    ),
    element(
      "DEMO-GOV.1.2",
      "اجتماعات لجنة الجودة بانتظام",
      "The quality committee meets regularly",
      "PM",
      false,
      "عُقد اجتماعان فقط من أربعة هذا العام.",
    ),
    element(
      "DEMO-GOV.2.1",
      "برنامج تعريفي للموظفين الجدد",
      "An orientation programme for new staff",
      "NA",
    ),
  ],
  findings: [
    {
      elementCode: "DEMO-MED.1.1",
      titleAr: "تخزين الأدوية عالية الخطورة بشكل منفصل",
      titleEn: "High-alert medicines are stored apart",
      severity: "esr",
      levelCode: "NM",
      statement: "وُجدت أدوية عالية الخطورة على الرف العام في غرفة العلاج.",
    },
    {
      elementCode: "DEMO-MED.1.2",
      titleAr: "توثيق درجات حرارة الثلاجة يوميًا",
      titleEn: "Fridge temperatures are logged daily",
      severity: "medium",
      levelCode: "PM",
      statement: "السجل ناقص لثلاثة أيام من الأسبوع الماضي.",
    },
    {
      elementCode: "DEMO-GOV.1.2",
      titleAr: "اجتماعات لجنة الجودة بانتظام",
      titleEn: "The quality committee meets regularly",
      severity: "medium",
      levelCode: "PM",
      statement: "Only two of four meetings were held this year.",
    },
  ],
  readyScore: 0.8,
  esrBlocksReadiness: true,
});
