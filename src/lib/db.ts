import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

// Three connection pools with different database roles (docs/ARCHITECTURE.md §5):
// - app:    `mustamir_app`, subject to Row-Level Security. Used for every tenant request.
// - auth:   `mustamir_auth`, reaches only the identity tables. Used by Better Auth and the
//           identity module, never for tenant data.
// - system: `mustamir_system`, bypasses RLS. Only for platform-admin work and cross-tenant
//           jobs, and every write through it must be audited.

export type Tx = Prisma.TransactionClient;

export type TenantContext = {
  tenantId: string;
  // Null for automated actions (jobs) that act on behalf of the tenant.
  userId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Clients = { app?: PrismaClient; auth?: PrismaClient; system?: PrismaClient };
const clients: Clients = ((globalThis as { __mustamirDb?: Clients }).__mustamirDb ??= {});

function createClient(
  variable: "DATABASE_URL" | "DATABASE_AUTH_URL" | "DATABASE_SYSTEM_URL",
): PrismaClient {
  const connectionString = process.env[variable];
  if (!connectionString) throw new Error(`${variable} is not set`);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function appClient() {
  return (clients.app ??= createClient("DATABASE_URL"));
}

/** The identity database client. Only `src/lib/auth.ts` and `modules/identity/repo.ts` use it. */
export function authDb() {
  return (clients.auth ??= createClient("DATABASE_AUTH_URL"));
}

function systemClient() {
  return (clients.system ??= createClient("DATABASE_SYSTEM_URL"));
}

/**
 * Runs `fn` in one transaction scoped to a tenant. RLS policies read `app.tenant_id`, which
 * is set with `is_local = true` so it can never leak to another request on the same pooled
 * connection.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.tenantId)) throw new Error("withTenant: tenantId must be a UUID");
  return appClient().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * The app role with no tenant set. RLS hides every tenant row, so only the narrow
 * SECURITY DEFINER lookups (a user's own memberships, an invitation by its token) return
 * anything. Used before the request knows which tenant it is working in.
 */
export async function withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appClient().$transaction(fn);
}

/** Cross-tenant access for platform operations. Callers must audit what they change. */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return systemClient().$transaction(fn);
}

export async function disconnectDb() {
  await Promise.all([
    clients.app?.$disconnect(),
    clients.auth?.$disconnect(),
    clients.system?.$disconnect(),
  ]);
  clients.app = undefined;
  clients.auth = undefined;
  clients.system = undefined;
}
