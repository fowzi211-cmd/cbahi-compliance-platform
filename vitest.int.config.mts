import "dotenv/config";
import { defineConfig } from "vitest/config";

// Integration tests run against a separate `<database>_test` database on the same server,
// using the same roles as the app (see .env.example).
function testUrl(variable: string): string {
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} must be set to run integration tests`);
  const url = new URL(value);
  if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

const env = {
  DATABASE_URL: testUrl("DATABASE_URL"),
  DATABASE_AUTH_URL: testUrl("DATABASE_AUTH_URL"),
  DATABASE_SYSTEM_URL: testUrl("DATABASE_SYSTEM_URL"),
  DATABASE_ADMIN_URL: testUrl("DATABASE_ADMIN_URL"),
  EMAIL_TRANSPORT: "memory",
};
Object.assign(process.env, env);

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    env,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
