import { z } from "zod";

const postgresUrl = (name: string) =>
  z.string().regex(/^postgres(ql)?:\/\//, `${name} must be a postgres:// connection string`);

// An empty value counts as unset: docker compose passes `${VAR:-}` through as "".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// Every environment variable the app reads is declared here and validated once at startup.
// Keep this in sync with `.env.example`.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: postgresUrl("DATABASE_URL"),
  DATABASE_AUTH_URL: postgresUrl("DATABASE_AUTH_URL"),
  DATABASE_SYSTEM_URL: postgresUrl("DATABASE_SYSTEM_URL"),
  BETTER_AUTH_SECRET: z.string().min(32),
  S3_ENDPOINT: z.url(),
  // Where browsers reach the store, for signed download links. Unset means S3_ENDPOINT.
  S3_PUBLIC_ENDPOINT: optional(z.url()),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_DRIVER: z.enum(["s3", "memory"]).default("s3"),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().min(1),
  // Both or neither: a relay that needs a login (a hosted provider), not Mailpit.
  SMTP_USER: optional(z.string()),
  SMTP_PASSWORD: optional(z.string()),
  EMAIL_TRANSPORT: z.enum(["smtp", "memory"]).default("smtp"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** The validated environment, parsed on first use. */
export function env(): Env {
  return (cached ??= parseEnv(process.env));
}
