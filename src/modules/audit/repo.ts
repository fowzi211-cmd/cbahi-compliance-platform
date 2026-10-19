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

export async function listAuditEvents(
  tx: Tx,
  filter: { entity?: string; entityId?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const rows = await tx.auditEvent.findMany({
    where: { entity: filter.entity, entityId: filter.entityId },
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
