import { runSnapshots } from "@/modules/dashboards/jobs";
import { runStruggleSignals } from "@/modules/subscriptions/jobs";
import { runDocumentReminders } from "@/modules/documents/jobs";
import { runCapaEscalation } from "@/modules/findings/jobs";
import { deliverImmediate, sendDigests } from "@/modules/notifications/jobs";
import { listTenantIds } from "@/modules/tenancy/service";

// The jobs, each visiting every tenant in its own tenant transaction (RLS applies). Only the
// tenant list is read across tenants. One tenant's failure is logged and does not stop the
// others. `now` comes from the caller, so a test or `pnpm jobs:run --now` can fake the clock.

export const jobNames = ["reminders", "deliver", "digest", "snapshots", "signals"] as const;
export type JobName = (typeof jobNames)[number];

const perTenant: Record<JobName, (tenantId: string, now: Date) => Promise<unknown>> = {
  // Daily: document reminders and CAPA escalation create notices.
  reminders: async (tenantId, now) => ({
    documents: await runDocumentReminders(tenantId, now),
    capa: await runCapaEscalation(tenantId, now),
  }),
  // Every minute: urgent notices go out by email.
  deliver: deliverImmediate,
  // Daily, after the reminders: everything else in one email per person.
  digest: sendDigests,
  // Nightly, just before the Riyadh day ends: the day's compliance snapshot for the trend.
  snapshots: runSnapshots,
  // Nightly, after the snapshot: offer help to Platform facilities that are struggling.
  signals: runStruggleSignals,
};

export async function runJob(name: JobName, now: Date) {
  const results: Record<string, unknown> = {};
  for (const tenantId of await listTenantIds()) {
    try {
      results[tenantId] = await perTenant[name](tenantId, now);
    } catch (error) {
      // Ids and the error only: never notice contents or personal data.
      console.error(`job ${name} failed for tenant ${tenantId}`, error);
      results[tenantId] = { error: true };
    }
  }
  return results;
}
