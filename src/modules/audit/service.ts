import { withSystem, withTenant, type TenantContext, type Tx } from "@/lib/db";
import type { AuditEvent, AuditEventInput, ChainVerification } from "./domain/types";
import * as repo from "./repo";

export type { AuditFilter } from "./repo";

export type { AuditAction, AuditEvent, AuditEventInput } from "./domain/types";

/**
 * Records an audit event inside the caller's transaction, so the change and its audit
 * record commit or roll back together.
 */
export function recordAudit(tx: Tx, ctx: TenantContext, event: AuditEventInput) {
  return repo.insertAuditEvent(tx, ctx.tenantId, ctx.userId, event);
}

/** Platform-level events (no tenant), for work done through the system connection. */
export function recordPlatformAudit(tx: Tx, actorUserId: string | null, event: AuditEventInput) {
  return repo.insertAuditEvent(tx, null, actorUserId, event);
}

export function listAuditEvents(
  ctx: TenantContext,
  filter?: repo.AuditFilter,
): Promise<AuditEvent[]> {
  return withTenant(ctx, (tx) => repo.listAuditEvents(tx, filter));
}

/** What the tenant's log contains, for filter lists. Permission checks belong to the caller. */
export function listAuditFacets(ctx: TenantContext) {
  return withTenant(ctx, (tx) => repo.listAuditFacets(tx));
}

export function verifyAuditChain(ctx: TenantContext): Promise<ChainVerification> {
  return withTenant(ctx, (tx) => repo.verifyChain(tx, ctx.tenantId));
}

/**
 * Verifies every chain in the database: each tenant's and the platform's own (tenant null).
 * For the `audit:verify` command; reads only, through the system connection.
 */
export async function verifyAllChains(): Promise<
  { tenantId: string | null; result: ChainVerification }[]
> {
  const tenantIds = await withSystem((tx) => repo.listChainTenants(tx));
  const results: { tenantId: string | null; result: ChainVerification }[] = [];
  for (const tenantId of [null, ...tenantIds]) {
    results.push({ tenantId, result: await withSystem((tx) => repo.verifyChain(tx, tenantId)) });
  }
  return results;
}
