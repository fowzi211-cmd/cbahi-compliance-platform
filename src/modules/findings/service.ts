import { uuidv7 } from "uuidv7";
import { withTenant, type Tx } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service";
import { allowed, getFacility, type AccessContext } from "@/modules/tenancy/service";
import { findingSeverity, type FindingStatus } from "./domain/severity";
import * as repo from "./repo";

export { findingSeverities, findingStatuses } from "./domain/severity";
export type { FindingSeverity, FindingStatus } from "./domain/severity";

export type FindingSource = {
  facilityId: string;
  assessmentId: string;
  elementScoreId: string;
  elementId: string;
  elementCode: string;
  departmentId: string | null;
  levelCode: string;
  isEsr: boolean;
  // The level as a fraction of full compliance (0..1).
  normalized: number;
  comment: string | null;
};

/**
 * Raises one finding per score, inside the caller's transaction, so a submitted assessment
 * and its findings commit together (rule 6). The caller has already checked permission and
 * picked the scores whose level generates findings.
 */
export async function raiseFindings(tx: Tx, ctx: AccessContext, sources: FindingSource[]) {
  if (sources.length === 0) return [];
  const rows = sources.map((s) => ({
    id: uuidv7(),
    facilityId: s.facilityId,
    assessmentId: s.assessmentId,
    elementScoreId: s.elementScoreId,
    elementId: s.elementId,
    departmentId: s.departmentId,
    levelCode: s.levelCode,
    severity: findingSeverity(s),
    statement: s.comment,
  }));
  await repo.insertFindings(tx, ctx.tenantId, rows);
  for (const [i, row] of rows.entries()) {
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "finding",
      entityId: row.id,
      after: {
        assessmentId: row.assessmentId,
        element: sources[i]!.elementCode,
        levelCode: row.levelCode,
        severity: row.severity,
      },
    });
  }
  return rows.map((r) => r.id);
}

export type Finding = Awaited<ReturnType<typeof listFindings>>[number];

/**
 * A facility's findings the caller may see: everything for those with facility-wide access,
 * only their own department's for a department head or staff member.
 */
export async function listFindings(
  ctx: AccessContext,
  facilityId: string,
  filter: { assessmentId?: string; status?: FindingStatus } = {},
) {
  if (!(await getFacility(ctx, facilityId))) return [];
  const rows = await withTenant(ctx, (tx) =>
    repo.listFindings(tx, ctx.tenantId, facilityId, filter),
  );
  return rows.filter((row) =>
    allowed(ctx, "dashboard.view", { facilityId, departmentId: row.departmentId }),
  );
}
