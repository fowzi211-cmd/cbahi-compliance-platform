import "dotenv/config";
import { Client } from "pg";

// Deployed databases only (docs/DEPLOYMENT.md). Creates the three login roles the app uses
// and sets their passwords from the connection strings, so each password lives in one place.
// Local development uses scripts/db/dev-roles.sql instead. Runs before `prisma migrate
// deploy`, as the migrations grant to these roles. The attributes match those migrations:
// only the system role bypasses Row-Level Security.

const roles = [
  { variable: "DATABASE_URL", name: "mustamir_app", attributes: "NOBYPASSRLS" },
  { variable: "DATABASE_AUTH_URL", name: "mustamir_auth", attributes: "NOBYPASSRLS" },
  { variable: "DATABASE_SYSTEM_URL", name: "mustamir_system", attributes: "BYPASSRLS" },
] as const;

function required(variable: string) {
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} is not set`);
  return value;
}

async function main() {
  const admin = new Client({ connectionString: required("DATABASE_ADMIN_URL") });
  await admin.connect();
  try {
    for (const role of roles) {
      const url = new URL(required(role.variable));
      if (decodeURIComponent(url.username) !== role.name) {
        throw new Error(`${role.variable} must connect as ${role.name}`);
      }
      const password = decodeURIComponent(url.password);
      if (password.length < 16) throw new Error(`${role.variable} needs a stronger password`);
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role.name]);
      if (exists.rowCount === 0) {
        await admin.query(
          `CREATE ROLE ${role.name} NOSUPERUSER ${role.attributes} NOCREATEDB NOCREATEROLE`,
        );
      }
      await admin.query(`ALTER ROLE ${role.name} LOGIN PASSWORD ${admin.escapeLiteral(password)}`);
      console.log(`role ${role.name} ready`);
    }
  } finally {
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
