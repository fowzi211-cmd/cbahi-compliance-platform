import JSZip from "jszip";
import { z } from "zod";
import { startOfRiyadhDay, toRiyadhDay } from "@/lib/dates";
import { withTenant } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getObject } from "@/lib/storage";
import {
  listAuditEvents,
  listAuditFacets,
  recordAudit,
  verifyAuditChain,
  type AuditEvent,
} from "@/modules/audit/service";
import {
  allowed,
  listFacilitiesIn,
  listUserNames,
  type AccessContext,
  type Action,
} from "@/modules/tenancy/service";
import { documentFilePath, exportFileName, exportReadme, exportTables } from "./domain/export";
import * as repo from "./repo";

export { exportTables } from "./domain/export";

// Oversight of the whole organization (M16): the audit log viewer and the tenant's data
// export. Both cover every facility of the tenant, because the audit log and the export are
// kept per tenant, not per facility. So both need the right in every facility: a quality
// manager of one clinic must not read another clinic's history through them.

async function holdsEverywhere(ctx: AccessContext, action: Action) {
  const facilities = await withTenant(ctx, (tx) => listFacilitiesIn(tx, ctx));
  return (
    facilities.length > 0 &&
    facilities.every((f) => allowed(ctx, action, { facilityId: f.id, departmentId: null }))
  );
}

export function canViewAuditLog(ctx: AccessContext) {
  return holdsEverywhere(ctx, "audit.view");
}

export function canExportData(ctx: AccessContext) {
  return holdsEverywhere(ctx, "data.export");
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const auditQuery = z.object({
  action: z.string().max(40).optional(),
  entity: z.string().max(60).optional(),
  actor: z.uuid().optional(),
  from: day.optional(),
  to: day.optional(),
  before: z.coerce.number().int().positive().optional(),
});
export type AuditQuery = z.input<typeof auditQuery>;

export const auditPageSize = 50;

export type AuditLogEntry = AuditEvent & {
  // "person" with a name; "platform" for the platform team (not visible to the tenant);
  // "system" for jobs and sign-in events without a signed-in actor.
  actor: { kind: "person"; name: string } | { kind: "platform" } | { kind: "system" };
};

/**
 * One page of the organization's audit log, newest first, with the filter choices. Query
 * values come from the URL; an unparseable one is dropped rather than failing the page.
 */
export async function getAuditLog(ctx: AccessContext, query: AuditQuery) {
  if (!(await canViewAuditLog(ctx))) throw new ForbiddenError("audit.view");
  const parsed = auditQuery.safeParse(query);
  const q = parsed.success ? parsed.data : {};
  const to = q.to ? new Date(startOfRiyadhDay(q.to).getTime() + 86_400_000 - 1) : undefined;
  const events = await listAuditEvents(ctx, {
    action: q.action || undefined,
    entity: q.entity || undefined,
    actorUserId: q.actor,
    from: q.from ? startOfRiyadhDay(q.from) : undefined,
    to,
    beforeSeq: q.before,
    // One more than a page, to know whether there is an older page.
    limit: auditPageSize + 1,
  });
  const page = events.slice(0, auditPageSize);
  const facets = await listAuditFacets(ctx);
  const names = await listUserNames(ctx, [
    ...new Set([...facets.actorUserIds, ...page.flatMap((e) => e.actorUserId ?? [])]),
  ]);
  const entries: AuditLogEntry[] = page.map((event) => {
    const name = event.actorUserId ? names.get(event.actorUserId) : undefined;
    return {
      ...event,
      actor: name
        ? { kind: "person", name }
        : event.actorUserId
          ? { kind: "platform" }
          : { kind: "system" },
    };
  });
  return {
    query: q,
    entries,
    olderBefore: events.length > auditPageSize ? page.at(-1)!.chainSeq : null,
    facets: {
      actions: facets.actions,
      entities: facets.entities,
      actors: [...names.entries()]
        .filter(([id]) => facets.actorUserIds.includes(id))
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/** Whether the organization's audit chain is intact (rule: append-only, hash-chained). */
export async function getAuditChainStatus(ctx: AccessContext) {
  if (!(await canViewAuditLog(ctx))) throw new ForbiddenError("audit.view");
  return verifyAuditChain(ctx);
}

/**
 * Everything the organization has stored, as one ZIP: a JSON file per tenant-owned table,
 * the people it can see, and every document file. Built in memory, which suits the small
 * and medium facilities this platform is for; a very large tenant would need a background
 * job instead. Audited as an export.
 */
export async function exportTenantData(ctx: AccessContext, now = new Date()) {
  if (!(await canExportData(ctx))) throw new ForbiddenError("data.export");
  await consumeRateLimit("dataExport", ctx.userId);

  const zip = new JSZip();
  const counts: { table: string; rows: number }[] = [];
  let tenantName = "";
  const { people, files } = await withTenant(ctx, async (tx) => {
    for (const table of exportTables) {
      const rows = await repo.exportTable(tx, table);
      if (table === "tenant") tenantName = String((rows[0] as { name?: string })?.name ?? "");
      counts.push({ table, rows: rows.length });
      zip.file(`data/${table}.json`, JSON.stringify(rows, null, 2));
    }
    return {
      people: await repo.exportPeople(tx),
      files: await repo.listStoredFiles(tx, ctx.tenantId),
    };
  });
  zip.file("people.json", JSON.stringify(people, null, 2));
  for (const file of files) {
    zip.file(documentFilePath(file), await getObject(file.storageKey));
  }
  zip.file(
    "README.txt",
    exportReadme({
      tenantName,
      generatedAt: now.toISOString(),
      tables: counts,
      people: people.length,
      files: files.length,
    }),
  );
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      action: "export",
      entity: "tenant",
      entityId: ctx.tenantId,
      after: {
        kind: "data_export",
        rows: counts.reduce((sum, c) => sum + c.rows, 0),
        files: files.length,
        bytes: bytes.length,
      },
    }),
  );
  return { fileName: exportFileName(toRiyadhDay(now)), bytes };
}
