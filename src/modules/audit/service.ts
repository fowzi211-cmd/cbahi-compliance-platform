import { withTenant, type TenantContext, type Tx } from "@/lib/db";
import type { AuditEvent, AuditEventInput, ChainVerification } from "./domain/types";
import * as repo from "./repo";

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
  filter?: { entity?: string; entityId?: string; limit?: number },
): Promise<AuditEvent[]> {
  return withTenant(ctx, (tx) => repo.listAuditEvents(tx, filter));
}

export function verifyAuditChain(ctx: TenantContext): Promise<ChainVerification> {
  return withTenant(ctx, (tx) => repo.verifyChain(tx, ctx.tenantId));
}
