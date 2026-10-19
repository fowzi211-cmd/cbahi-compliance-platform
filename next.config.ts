import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Native module: load it from node_modules at runtime instead of bundling it. The PDF
  // reader is kept out of the bundle too, as it loads its worker from its own package.
  serverExternalPackages: ["@node-rs/argon2", "unpdf", "mammoth"],
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
