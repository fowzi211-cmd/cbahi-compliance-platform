import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries (docs/ARCHITECTURE.md §2):
// - code inside a module uses relative imports for its own files;
// - other modules are reached only through `@/modules/<name>/service`;
// - `domain/` is pure: no Prisma, no Next.js, no lib I/O.
// - routes (src/app) may also render a module's `ui/` components.
const moduleInternals = [
  "@/modules/*/repo",
  "@/modules/*/repo.*",
  "@/modules/*/jobs",
  "@/modules/*/domain",
  "@/modules/*/domain/**",
];
const crossModuleInternals = {
  group: [...moduleInternals, "@/modules/*/ui/**"],
  message: "Import another module only through its service: @/modules/<name>/service.",
};
const routeModuleInternals = {
  group: moduleInternals,
  message: "Routes reach modules through their service or ui/ components.",
};

// RTL: physical direction utilities break the mirrored Arabic layout. Use logical ones
// (ms-/me-/ps-/pe-/start-/end-/text-start/border-s/rounded-s...) instead.
const physicalDirectionClass =
  "/(^|[\\s:])-?(m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|scroll-[mp][lr])-|(^|[\\s:])(text|float|clear)-(left|right)(\\s|$)/";
const rtlMessage =
  "Use logical Tailwind utilities (ms-, me-, ps-, pe-, start-, end-, text-start, border-s, rounded-s) so layouts mirror in Arabic.";

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
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [routeModuleInternals] }],
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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use `as const` unions instead of enums." },
        { selector: `Literal[value=${physicalDirectionClass}]`, message: rtlMessage },
        { selector: `TemplateElement[value.raw=${physicalDirectionClass}]`, message: rtlMessage },
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
    "src/generated/**",
  ]),
]);

export default eslintConfig;
