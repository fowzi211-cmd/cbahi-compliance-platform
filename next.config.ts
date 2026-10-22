import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  async headers() {
    const headers = securityHeaders({
      https: (process.env.APP_URL ?? "").startsWith("https://"),
      dev: process.env.NODE_ENV === "development",
    });
    return [{ source: "/:path*", headers }];
  },
  // Native module: load it from node_modules at runtime instead of bundling it. The PDF
  // reader is kept out of the bundle too, as it loads its worker from its own package.
  // playwright-core launches Chromium to print reports and must not be bundled either.
  serverExternalPackages: ["@node-rs/argon2", "unpdf", "mammoth", "playwright-core"],
  partialPrefetching: true,
  experimental: {
    // Framework imports (5 MB) and documents (10 MB) are uploaded through server actions,
    // so the file can be checked and scanned before it is stored. Both limits are checked
    // again in the services; the default 1 MB body limit would cut them off.
    serverActions: { bodySizeLimit: "11mb" },
    proxyClientMaxBodySize: "11mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
