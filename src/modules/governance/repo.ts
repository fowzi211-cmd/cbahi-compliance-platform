import type { Tx } from "@/lib/db";
import { droppedColumns, exportTables, type ExportTable } from "./domain/export";

// Reads for the tenant data export. Each runs inside `withTenant`, so row-level security
// returns only the caller's tenant. Table names come from the fixed list in domain/export.ts,
// never from input.

/** Every row of one tenant-owned table as JSON, converted by Postgres itself. */
export async function exportTable(tx: Tx, table: ExportTable): Promise<unknown[]> {
  if (!(exportTables as readonly string[]).includes(table)) throw new Error(`Not exportable`);
  const dropped = [...(droppedColumns[table] ?? [])];
  const [row] = await tx.$queryRawUnsafe<{ rows: unknown[] }[]>(
    `SELECT coalesce(json_agg(to_jsonb(t) - $1::text[]), '[]'::json) AS rows FROM "${table}" t`,
    dropped,
  );
  return row?.rows ?? [];
}

/** The people the tenant can see: members and assigned consultants (name and email only). */
export function exportPeople(tx: Tx) {
  return tx.user.findMany({
    select: { id: true, name: true, email: true, locale: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Every stored document version, to copy its file into the archive. */
export function listStoredFiles(tx: Tx, tenantId: string) {
  return tx.documentVersion.findMany({
    where: { tenantId },
    select: { documentId: true, version: true, fileName: true, storageKey: true },
    orderBy: [{ documentId: "asc" }, { version: "asc" }],
  });
}
