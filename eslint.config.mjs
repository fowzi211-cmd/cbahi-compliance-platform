import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries (docs/ARCHITECTURE.md §2):
// - code inside a module uses relative imports for its own files;
// - other modules are reached only through `@/modules/<name>/service`;
// - `domain/` is pure: no Prisma, no Next.js, no lib I/O.
const crossModuleInternals = {
  group: [
    "@/modules/*/repo",
    "@/modules/*/repo.*",
    "@/modules/*/jobs",
    "@/modules/*/domain",
    "@/modules/*/domain/**",
    "@/modules/*/ui/**",
  ],
  message: "Import another module only through its service: @/modules/<name>/service.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use `as const` unions instead of enums." },
      ],
      "no-restricted-imports": ["error", { patterns: [crossModuleInternals] }],
    },
  },
  {
    files: ["src/modules/*/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            crossModuleInternals,
            {
              group: ["@prisma/*", "next", "next/*", "react", "@/lib/*", "@/modules/*"],
              message: "domain/ must stay pure: no I/O, frameworks or other modules.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
