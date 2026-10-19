import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://app:app@localhost:5432/mustamir",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "me-central-1",
  S3_BUCKET: "evidence",
  S3_ACCESS_KEY_ID: "minio",
  S3_SECRET_ACCESS_KEY: "minio-secret",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_FROM: "Mustamir <no-reply@localhost>",
};

describe("parseEnv", () => {
  it("accepts a complete configuration and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.SMTP_PORT).toBe(1025);
  });

  it("rejects a non-postgres database url", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("lists every missing variable in one error", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*S3_ENDPOINT[\s\S]*SMTP_HOST/);
  });
});
