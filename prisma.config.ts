import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations run as the database owner. The app itself connects as `mustamir_app`, a role
// without BYPASSRLS, so Row-Level Security applies to every query it makes.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed/index.ts" },
  // Read leniently so `prisma generate` (which needs no database) works in CI and on install.
  datasource: { url: process.env.DATABASE_ADMIN_URL ?? "" },
});
