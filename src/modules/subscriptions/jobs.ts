import { withTenant, type TenantContext } from "@/lib/db";
import { daysBetween } from "@/lib/dates";
import { recordAudit } from "@/modules/audit/service";
import { evaluateCompliance } from "@/modules/assessments/service";
import { nextExpectedSurveyIn } from "@/modules/surveys/service";
import { listFacilitiesIn } from "@/modules/tenancy/service";
import { offerAllowed, struggleSignal } from "./domain/struggle";
import { featureEnabledIn } from "./service";
import * as repo from "./repo";

/**
 * The nightly struggle signal (rule 9): for each facility of a tenant with the feature on
 * (Platform tier by default), check the facility's state and, if it is struggling and no
 * offer was made in the cool-down, leave an `offered` service request for the facility to
 * answer. Facilities with no framework chosen yet are skipped: there is nothing to judge.
 * Returns the ids of the offers made.
 */
export async function runStruggleSignals(tenantId: string, now: Date) {
  const ctx: TenantContext = { tenantId, userId: null };
  return withTenant(ctx, async (tx) => {
    if (!(await featureEnabledIn(tx, ctx, "struggleSignal", now))) return [];
    const offers: string[] = [];
    for (const facility of await listFacilitiesIn(tx, ctx)) {
      const results = await evaluateCompliance(tx, ctx, facility, now);
      if (results.length === 0) continue;
      const next = await nextExpectedSurveyIn(tx, ctx, facility.id);
      const scores = results.map((r) => r.internal.facility.score);
      const reasons = struggleSignal({
        esrNotMet: results.reduce((sum, r) => sum + r.internal.facility.esrNotMet, 0),
        overdueCapa: results[0]!.capa.overdue,
        // The weakest edition decides: a survey checks every one of them.
        score: scores.includes(null) ? null : Math.min(...(scores as number[])),
        surveyInDays: next ? daysBetween(now, new Date(`${next}T12:00:00Z`)) : null,
      });
      if (reasons.length === 0) continue;
      const last = await repo.findLatestOffer(tx, tenantId, facility.id);
      const allowed = offerAllowed(
        last ? { createdAt: last.createdAt, waiting: last.status === "offered" } : null,
        now,
      );
      if (!allowed) continue;
      const row = await repo.insertRequest(tx, {
        tenantId,
        facilityId: facility.id,
        kind: null,
        status: "offered",
        origin: "struggle_signal",
        signalReasons: reasons,
        // The job's clock, so the cool-down counts from the night the offer was made.
        createdAt: now,
      });
      await recordAudit(tx, ctx, {
        action: "create",
        entity: "service_request",
        entityId: row.id,
        after: { status: "offered", origin: "struggle_signal", reasons },
      });
      offers.push(row.id);
    }
    return offers;
  });
}
