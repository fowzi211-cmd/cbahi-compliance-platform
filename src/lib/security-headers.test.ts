import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const header = (list: { key: string; value: string }[], key: string) =>
  list.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it.each([
    [{ https: true, dev: false }, true],
    [{ https: false, dev: false }, false],
  ])("sends HSTS only over https (%o)", (options, hsts) => {
    expect(header(securityHeaders(options), "Strict-Transport-Security") !== undefined).toBe(hsts);
  });

  it("always forbids framing, sniffing and cross-site referrers", () => {
    const list = securityHeaders({ https: false, dev: false });
    expect(header(list, "X-Frame-Options")).toBe("DENY");
    expect(header(list, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(list, "Referrer-Policy")).toBe("same-origin");
  });
});

describe("contentSecurityPolicy", () => {
  it.each([
    [{ https: true, dev: false }, ["upgrade-insecure-requests"], ["unsafe-eval"]],
    [{ https: false, dev: false }, [], ["unsafe-eval", "upgrade-insecure-requests"]],
    [{ https: false, dev: true }, ["'unsafe-eval'"], ["upgrade-insecure-requests"]],
  ])("%o", (options, present, absent) => {
    const csp = contentSecurityPolicy(options);
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "connect-src 'self'",
      ...present,
    ]) {
      expect(csp).toContain(directive);
    }
    for (const text of absent) expect(csp).not.toContain(text);
  });
});
