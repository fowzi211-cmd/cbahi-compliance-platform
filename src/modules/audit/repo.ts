import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import {
  toSnapshot,
  type AuditEvent,
  type AuditEventInput,
  type ChainVerification,
} from "./domain/types";

const json = (value: unknown) =>
  value === undefined || value === null
    ? Prisma.DbNull
    : (toSnapshot(value) as Prisma.InputJsonValue);

export async function insertAuditEvent(
  tx: Tx,
  tenantId: string | null,
  actorUserId: string | null,
  event: AuditEventInput,
): Promise<void> {
  // `at`, `chain_seq` and the hashes are set by the database trigger.
  await tx.auditEvent.create({
    data: {
      tenantId,
      actorUserId,
      action: event.action,
      entity: event.entity,
      entityId: event.entityId ?? null,
      before: json(event.before),
      after: json(event.after),
      ip: event.ip ?? null,
    },
  });
}

export type AuditFilter = {
  entity?: string;
  entityId?: string;
  action?: string;
  actorUserId?: string;
  // Inclusive bounds on `at`.
  from?: Date;
  to?: Date;
  // Paging: only events older than this chain position.
  beforeSeq?: number;
  limit?: number;
};

export async function listAuditEvents(tx: Tx, filter: AuditFilter = {}): Promise<AuditEvent[]> {
  const rows = await tx.auditEvent.findMany({
    where: {
      entity: filter.entity,
      entityId: filter.entityId,
      action: filter.action,
      actorUserId: filter.actorUserId,
      at: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
      chainSeq: filter.beforeSeq === undefined ? undefined : { lt: filter.beforeSeq },
    },
    orderBy: { chainSeq: "desc" },
    take: filter.limit ?? 100,
  });
  return rows.map((row) => ({
    id: row.id.toString(),
    tenantId: row.tenantId,
    chainSeq: Number(row.chainSeq),
    actorUserId: row.actorUserId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    at: row.at,
  }));
}

/** The actions, entities and actors that occur in the visible log, for the filter lists. */
export async function listAuditFacets(tx: Tx) {
  // GROUP BY runs in Postgres (Prisma's `distinct` would read every row). One after another:
  // queries on one transaction's connection cannot overlap.
  const actions = await tx.auditEvent.groupBy({ by: ["action"] });
  const entities = await tx.auditEvent.groupBy({ by: ["entity"] });
  const actors = await tx.auditEvent.groupBy({
    by: ["actorUserId"],
    where: { actorUserId: { not: null } },
  });
  return {
    actions: actions.map((r) => r.action).sort(),
    entities: entities.map((r) => r.entity).sort(),
    actorUserIds: actors.map((r) => r.actorUserId!),
  };
}

export async function verifyChain(tx: Tx, tenantId: string | null): Promise<ChainVerification> {
  const [result] = await tx.$queryRaw<
    { ok: boolean; checked: bigint; first_broken_seq: bigint | null }[]
  >`SELECT * FROM audit_verify_chain(${tenantId}::uuid)`;
  return {
    ok: result.ok,
    checked: Number(result.checked),
    firstBrokenSeq: result.first_broken_seq === null ? null : Number(result.first_broken_seq),
  };
}

/** Every tenant that has a chain, oldest first (system connection only). */
export async function listChainTenants(tx: Tx): Promise<string[]> {
  const rows = await tx.tenant.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => r.id);
}
