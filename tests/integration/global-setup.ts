import { execFileSync } from "node:child_process";
import { Client } from "pg";

// Creates the test database if needed, makes sure the app roles exist, and applies all
// migrations. Tests then create their own tenants, so no data is wiped between runs
// (the audit log is append-only by design and could not be truncated anyway).
export default async function setup() {
  const adminUrl = new URL(process.env.DATABASE_ADMIN_URL!);
  const database = adminUrl.pathname.slice(1);
  const serverUrl = new URL(adminUrl);
  serverUrl.pathname = "/postgres";

  const client = new Client({ connectionString: serverUrl.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${database}"`);
  await client.end();

  const prisma = (...args: string[]) =>
    execFileSync("pnpm", ["exec", "prisma", ...args], { stdio: "pipe", env: process.env });
  prisma("db", "execute", "--file", "scripts/db/dev-roles.sql");
  prisma("migrate", "deploy");
}
