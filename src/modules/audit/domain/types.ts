export type AuditAction =
  | "create"
  | "update"
  | "archive"
  | "delete"
  | "approve"
  | "export"
  | "login"
  | "lock"
  | "revoke"
  | "accept"
  | "activate"
  | "retire";

export type AuditEventInput = {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

export type AuditEvent = {
  id: string;
  tenantId: string | null;
  chainSeq: number;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  at: Date;
};

export type ChainVerification = { ok: boolean; checked: number; firstBrokenSeq: number | null };

// Dates and other non-JSON values become plain JSON so the stored snapshot is what was seen.
export function toSnapshot(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
