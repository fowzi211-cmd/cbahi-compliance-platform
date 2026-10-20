import { withTenant, type TenantContext } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { evaluateCompliance } from "@/modules/assessments/service";
import { listFacilitiesIn } from "@/modules/tenancy/service";
import * as repo from "./repo";

const nodeOf = (node: { score: number | null; counted: number; scored: number }) => ({
  score: node.score,
  counted: node.counted,
  scored: node.scored,
});

/**
 * The nightly `ComplianceSnapshot` (ARCHITECTURE §3.3): for every facility and edition, what
 * readiness looked like on the Riyadh day of `now`, internal series always and the consultant
 * series once a consultant has scored. Running twice on one day adds nothing. Returns how
 * many rows were written.
 */
export async function runSnapshots(tenantId: string, now: Date) {
  const ctx: TenantContext = { tenantId, userId: null };
  const day = new Date(`${toRiyadhDay(now)}T00:00:00Z`);
  return withTenant(ctx, async (tx) => {
    const rows: repo.SnapshotRow[] = [];
    for (const facility of await listFacilitiesIn(tx, ctx)) {
      for (const result of await evaluateCompliance(tx, ctx, facility, now)) {
        const series: [repo.SnapshotRow["series"], typeof result.internal][] = [
          ["internal", result.internal],
        ];
        if (result.consultant) series.push(["consultant", result.consultant]);
        for (const [name, breakdown] of series) {
          rows.push({
            facilityId: facility.id,
            frameworkId: result.framework.id,
            day,
            series: name,
            status: breakdown.status,
            score: breakdown.facility.score === null ? null : round(breakdown.facility.score),
            counted: breakdown.facility.counted,
            scored: breakdown.facility.scored,
            esrNotMet: breakdown.facility.esrNotMet,
            esrUnverified: breakdown.facility.esrUnverified,
            elementsExpired: breakdown.expired,
            overdueCapa: result.capa.overdue,
            chapters: breakdown.chapters.map((c) => ({ chapterId: c.chapterId, ...nodeOf(c) })),
            departments: breakdown.departments.map((d) => ({
              departmentId: d.departmentId,
              ...nodeOf(d),
            })),
            createdAt: now,
          });
        }
      }
    }
    return repo.insertSnapshots(tx, tenantId, rows);
  });
}

// The column keeps five decimals; rounding here keeps the stored value what was computed.
const round = (score: number) => Math.round(score * 100_000) / 100_000;
