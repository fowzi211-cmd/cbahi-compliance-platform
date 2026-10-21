// A tenant's copy of all its data (PDPL data portability, ARCHITECTURE §6, M16). Pure: which
// tables go in, what is left out, and how the archive is laid out.

/**
 * Every tenant-owned table, exported whole as JSON. Row-level security limits each to the
 * caller's tenant. An integration test fails when a new table with `tenant_id` is missing
 * here, so a later milestone cannot forget it.
 */
export const exportTables = [
  "tenant",
  "subscription",
  "facility",
  "department",
  "membership",
  "invitation",
  "facility_framework",
  "element_applicability",
  "survey_cycle",
  "assessment",
  "assessment_element",
  "element_score",
  "score_evidence",
  "element_status",
  "finding",
  "capa_item",
  "capa_evidence",
  "document",
  "document_version",
  "document_approval",
  "document_element",
  "survey_report",
  "tracer_template",
  "tracer_template_chapter",
  "tracer_run",
  "committee",
  "committee_element",
  "meeting",
  "compliance_snapshot",
  "notification",
  "notification_preference",
  "consultant_assignment",
  "service_request",
  "audit_event",
] as const;
export type ExportTable = (typeof exportTables)[number];

/**
 * Columns left out. An invitation's token hash is a credential for an open invitation, not
 * the tenant's information.
 */
export const droppedColumns: Partial<Record<ExportTable, readonly string[]>> = {
  invitation: ["token_hash"],
};

/** Where a stored document version goes in the archive: one folder per document. */
export function documentFilePath(input: { documentId: string; version: number; fileName: string }) {
  const safe = input.fileName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 150) || "file";
  return `files/${input.documentId}/v${input.version}-${safe}`;
}

/** The archive's name: the Riyadh day it was made. */
export function exportFileName(day: string) {
  return `mustamir-export-${day}.zip`;
}

/** A plain-text table of contents, in both languages, at the root of the archive. */
export function exportReadme(input: {
  tenantName: string;
  generatedAt: string;
  tables: readonly { table: string; rows: number }[];
  people: number;
  files: number;
}) {
  return [
    `Mustamir data export / تصدير بيانات مستمر`,
    ``,
    `Organization / المنظمة: ${input.tenantName}`,
    `Generated / تاريخ الإنشاء: ${input.generatedAt}`,
    ``,
    `data/*.json   One file per table, every row of this organization (JSON array).`,
    `              ملف لكل جدول يضم كل صفوف هذه المنظمة.`,
    `people.json   Names and emails of the people in this organization (${input.people}).`,
    `              أسماء الأشخاص في المنظمة وبريدهم.`,
    `files/        Every stored document version (${input.files}).`,
    `              كل نسخ المستندات المحفوظة.`,
    ``,
    `Not included / غير مشمول: passwords, sessions, second-factor secrets and invitation tokens.`,
    ``,
    ...input.tables.map((t) => `${t.table.padEnd(26)} ${t.rows}`),
    ``,
  ].join("\n");
}
