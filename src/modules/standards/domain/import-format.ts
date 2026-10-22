import { z } from "zod";

// Our own import schema for frameworks (docs/IMPORT_FORMAT.md). It is deliberately neutral:
// it describes chapters, standards, measurable elements and a scoring scale, so any
// licensed framework can be loaded at runtime without its text ever living in the repo.

export const formatVersion = "mustamir.framework/v1";

export const importFormats = ["csv", "xlsx", "json"] as const;
export type ImportFormat = (typeof importFormats)[number];

// The CBAHI national-standards programmes (codes and labels are ours). The first group are
// the programmes CBAHI currently surveys against; the second are still being written by
// CBAHI, listed so an edition can be imported the day it is published. Service programmes
// (acs, stroke, diabetes, dialysis...) are surveyed inside a facility of another type, so a
// facility adds them next to its main programme instead of getting them from its type.
export const programs = [
  "ambulatory",
  "primary",
  "lab",
  "blood_bank",
  "dental",
  "home_health",
  "hospital",
  "seasonal_hospital",
  "acs",
  // In preparation by CBAHI.
  "mental_health",
  "diabetes",
  "stroke",
  "rehabilitation",
  "oncology",
  "dialysis",
] as const;
export type Program = (typeof programs)[number];

// How a surveyor can verify an element. Drives which evidence the assessment asks for.
export const evidenceTypes = [
  "document",
  "observation",
  "interview",
  "record_review",
  "kpi",
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

export const sheetNames = ["framework", "scale", "chapters", "standards", "elements"] as const;
export type SheetName = (typeof sheetNames)[number];

/** Columns per sheet; the first ones listed in `required` must be present as headers. */
export const sheetColumns = {
  framework: {
    all: ["code", "edition", "name_ar", "name_en", "program", "rollup_config"],
    required: ["code", "edition", "program"],
  },
  scale: {
    all: [
      "code",
      "label_ar",
      "label_en",
      "value",
      "counts_in_denominator",
      "requires_evidence",
      "generates_finding",
    ],
    required: ["code", "value"],
  },
  chapters: { all: ["code", "title_ar", "title_en"], required: ["code"] },
  standards: {
    all: ["code", "chapter_code", "title_ar", "title_en", "weight"],
    required: ["code", "chapter_code"],
  },
  elements: {
    all: [
      "code",
      "standard_code",
      "title_ar",
      "title_en",
      "description_ar",
      "description_en",
      "is_esr",
      "weight",
      "evidence_types",
      "facility_types",
      "department_types",
    ],
    required: ["code", "standard_code"],
  },
} as const satisfies Record<SheetName, { all: readonly string[]; required: readonly string[] }>;

/** The single-file CSV layout: one row per element, chapter and standard repeated on each. */
export const flatCsvColumns = {
  all: [
    "chapter_code",
    "chapter_title_ar",
    "chapter_title_en",
    "standard_code",
    "standard_title_ar",
    "standard_title_en",
    "standard_weight",
    ...sheetColumns.elements.all.filter((c) => c !== "standard_code"),
  ],
  required: ["chapter_code", "standard_code", "code"],
} as const;

export const limits = {
  fileBytes: 5 * 1024 * 1024,
  elements: 5000,
  codeLength: 64,
  titleLength: 500,
  descriptionLength: 5000,
  licenseNoteLength: 2000,
} as const;

// Codes are identifiers people type and read in mixed-direction text, so they are kept to
// letters, digits and a few separators. Framework codes are uppercase Latin (they appear in
// URLs and reports).
export const frameworkCodePattern = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;
export const itemCodePattern = /^[\p{L}\p{N}][\p{L}\p{N}._\-/]{0,63}$/u;
export const scaleCodePattern = /^[A-Z][A-Z0-9_]{0,7}$/;
export const editionPattern = /^[\p{L}\p{N}][\p{L}\p{N}._\-/ ]{0,31}$/u;

const rollupMethod = z.enum(["weighted_average", "all_must_meet", "threshold"]);

/** How scores combine from elements up to the facility (ARCHITECTURE §3.1). */
export const rollupConfigSchema = z
  .object({
    standard: z
      .object({
        method: rollupMethod,
        met_threshold: z.number().min(0).max(1).default(1),
        pm_threshold: z.number().min(0).max(1).default(0.5),
      })
      .strict()
      .refine((s) => s.pm_threshold <= s.met_threshold, { path: ["pm_threshold"] })
      .default({ method: "weighted_average", met_threshold: 1, pm_threshold: 0.5 }),
    chapter: z.object({ method: rollupMethod }).strict().default({ method: "weighted_average" }),
    facility: z.object({ method: rollupMethod }).strict().default({ method: "weighted_average" }),
    esr: z
      .object({
        // ESR elements are pass/fail by design: partial compliance with a safety-critical
        // requirement is not compliance.
        allowed_levels: z.array(z.string()).min(1).default(["MET", "NM"]),
        any_not_met_blocks_readiness: z.boolean().default(true),
      })
      .strict()
      .default({ allowed_levels: ["MET", "NM"], any_not_met_blocks_readiness: true }),
  })
  .strict();
export type RollupConfig = z.infer<typeof rollupConfigSchema>;

export const defaultRollupConfig: RollupConfig = rollupConfigSchema.parse({});

const text = z.string().nullable();

export const scoreLevelSchema = z.object({
  code: z.string(),
  labelAr: text,
  labelEn: text,
  value: z.number(),
  countsInDenominator: z.boolean(),
  requiresEvidence: z.boolean(),
  generatesFinding: z.boolean(),
});
export type ScoreLevelInput = z.infer<typeof scoreLevelSchema>;

/**
 * The default four-level scale. Met and Partially Met need evidence (anti-decoration rule,
 * ARCHITECTURE decision 7); Partially Met and Not Met raise a finding; Not Applicable is left
 * out of the denominator.
 */
export const defaultScale: ScoreLevelInput[] = [
  {
    code: "MET",
    labelAr: "مستوفى",
    labelEn: "Met",
    value: 1,
    countsInDenominator: true,
    requiresEvidence: true,
    generatesFinding: false,
  },
  {
    code: "PM",
    labelAr: "مستوفى جزئيًا",
    labelEn: "Partially met",
    value: 0.5,
    countsInDenominator: true,
    requiresEvidence: true,
    generatesFinding: true,
  },
  {
    code: "NM",
    labelAr: "غير مستوفى",
    labelEn: "Not met",
    value: 0,
    countsInDenominator: true,
    requiresEvidence: false,
    generatesFinding: true,
  },
  {
    code: "NA",
    labelAr: "لا ينطبق",
    labelEn: "Not applicable",
    value: 0,
    countsInDenominator: false,
    requiresEvidence: false,
    generatesFinding: false,
  },
];

/** A validated, normalized edition: what is previewed, stored and committed. */
export const importDocumentSchema = z.object({
  framework: z.object({
    code: z.string(),
    edition: z.string(),
    nameAr: text,
    nameEn: text,
    program: z.enum(programs),
    rollupConfig: rollupConfigSchema,
  }),
  scale: z.array(scoreLevelSchema),
  chapters: z.array(z.object({ code: z.string(), titleAr: text, titleEn: text })),
  standards: z.array(
    z.object({
      code: z.string(),
      chapterCode: z.string(),
      titleAr: text,
      titleEn: text,
      weight: z.number(),
    }),
  ),
  elements: z.array(
    z.object({
      code: z.string(),
      standardCode: z.string(),
      titleAr: text,
      titleEn: text,
      descriptionAr: text,
      descriptionEn: text,
      isEsr: z.boolean(),
      weight: z.number(),
      evidenceTypes: z.array(z.enum(evidenceTypes)),
      facilityTypes: z.array(z.string()),
      departmentTypes: z.array(z.string()),
    }),
  ),
});
export type ImportDocument = z.infer<typeof importDocumentSchema>;
export type ChapterInput = ImportDocument["chapters"][number];
export type StandardInput = ImportDocument["standards"][number];
export type ElementInput = ImportDocument["elements"][number];
