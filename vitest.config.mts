import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/*.int.test.ts", "node_modules/**"],
    coverage: { provider: "v8", include: ["src/**/domain/**", "src/lib/**"] },
  },
});
