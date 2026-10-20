import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://app:app@localhost:5432/mustamir",
  DATABASE_AUTH_URL: "postgresql://auth:auth@localhost:5432/mustamir",
  DATABASE_SYSTEM_URL: "postgresql://system:system@localhost:5432/mustamir",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
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

  it("leaves the optional deployment settings unset", () => {
    const env = parseEnv(valid);
    expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
  });

  it("treats an empty optional setting as unset", () => {
    const env = parseEnv({ ...valid, S3_PUBLIC_ENDPOINT: "", SMTP_USER: "", SMTP_PASSWORD: "" });
    expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
    expect(env.SMTP_PASSWORD).toBeUndefined();
  });

  it("rejects a public storage endpoint that is not a url", () => {
    expect(() => parseEnv({ ...valid, S3_PUBLIC_ENDPOINT: "files.example" })).toThrow(
      /S3_PUBLIC_ENDPOINT/,
    );
  });

  it("rejects a non-postgres database url", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("lists every missing variable in one error", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*S3_ENDPOINT[\s\S]*SMTP_HOST/);
  });
});
