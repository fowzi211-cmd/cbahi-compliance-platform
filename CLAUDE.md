# CLAUDE.md — project conventions

Also read `AGENTS.md` (Next.js 16 notes). Read `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` before you change anything. They are the source of truth for design decisions. If a change contradicts them, update the doc in the same PR and say why.

## Non-negotiables

- **Never add CBAHI standard text** (or JCI or MOH text) to the repo: no seeds, fixtures, tests or comments. Use fictional `DEMO-*` content only. Real frameworks enter the system only through the importer at runtime.
- **No patient-identifiable data**, anywhere in the schema, seeds or fixtures.
- **Every tenant-owned table has `tenant_id` and an RLS policy.** Every new repository function gets an isolation test.
- **Every mutation of compliance data writes an `AuditEvent`** (scores, evidence, approvals, CAPA status, roles, exports).
- **Arabic first.** Every UI string goes through next-intl, with keys in both `messages/ar.json` and `messages/en.json`.
- Do not change public behavior of a business rule without updating its unit tests and the rules list in ARCHITECTURE §4.

## Workflow

- Work one roadmap milestone at a time, on branch `mNN-short-name` (for example `m06-scoring-engine`).
- For each milestone: code → tests → `pnpm check` green → a short "what was built / how to try it" summary → a PR. **Never push to `main`, merge, or deploy without the owner's go-ahead.**
- If a requirement looks ambiguous or wrong from an accreditation-practice point of view, stop and propose an alternative instead of guessing.

## Commands

```
docker compose up -d        # postgres, seaweedfs (S3), mailpit
pnpm dev                    # web on :3000
pnpm test                   # vitest unit
pnpm test:e2e               # playwright (desktop + mobile viewports)
pnpm lint / typecheck / format
pnpm i18n:check             # ar/en message keys and placeholders match
pnpm db:setup               # create local DB roles + apply migrations (after compose up)
pnpm db:migrate             # prisma migrate dev (new migration from schema changes)
pnpm test:int               # vitest integration against <db>_test (needs docker postgres)
pnpm db:seed                # fictional DEMO-AMB framework (idempotent)
pnpm platform:admin <email> # grant the platform-admin flag (add --revoke to remove)
pnpm worker                 # pg-boss worker: reminders 06:00, digest 07:00, email every minute
pnpm jobs:run <job> [--now ISO]  # run reminders|deliver|digest once (fake clock for tests)
# added by later milestones: demo tenant seed (M17)
pnpm check                  # lint + typecheck + format + i18n parity + unit + int
```

## Folder structure

```
src/app/[locale]/...        routes: thin — parse (zod) → service → render
src/modules/<module>/
  domain/                   pure TS: types, rules, no I/O, no Prisma imports
  service.ts                use cases: permission check → repo → audit → notify
  repo.ts                   the ONLY place that touches Prisma for this module
  jobs.ts                   pg-boss handlers
  ui/                       module-specific components
  *.test.ts                 next to the code it tests
src/lib/                    db, auth, i18n, storage, jobs, dates, pdf
src/components/ui/          shared shadcn/ui primitives
messages/{ar,en}.json
prisma/schema.prisma, prisma/migrations, prisma/seed/
tests/integration/, tests/e2e/
docs/
```

Modules call other modules **only through `service.ts`**. `domain/` imports nothing outside its module.

## Naming

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`. Tests: `*.test.ts` (unit), `*.int.test.ts` (integration), `tests/e2e/*.spec.ts`.
- TypeScript: `camelCase` variables and functions, `PascalCase` types, no `I` prefix, no enums (use `as const` unions).
- DB: Prisma models `PascalCase` mapped to `snake_case` tables and columns (`@@map`, `@map`). Bilingual columns are `title_ar` / `title_en`.
- Permissions: `module.action` strings (`assessment.score`, `document.approve`).
- i18n keys: `module.screen.element` (`capa.list.emptyState`).

## Code style

- TypeScript strict. No `any`. Validate every external input with Zod at the boundary.
- Server components by default, and `"use client"` only where needed. Mutations use server actions that call services.
- Dates are stored in UTC and formatted only through `lib/dates`. Never call `toLocaleString` directly.
- Keep business logic out of components and route handlers.
- Comments explain _why_, especially the accreditation reasoning behind a rule.

## i18n and RTL rules

- Use logical Tailwind utilities only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-` and `text-left` are lint errors.
- Directional icons get `rtl:-scale-x-100`.
- Wrap codes, emails and numbers embedded in Arabic text in `<bdi>`.
- No string concatenation for sentences. Use ICU messages with placeholders and plurals (Arabic has 6 plural forms).
- Test new screens in both locales. E2E specs run in `ar` by default.
- Format dates only through `src/lib/dates.ts` (Riyadh time, Gregorian, optional Umm al-Qura Hijri, Latin digits).
- A drawer or dialog inside the sticky header must be portalled to `<body>` (the header's backdrop blur clips `fixed` children).

## Testing

- Every rule in `domain/` has unit tests, table-driven where possible.
- Integration tests use a real Postgres with RLS enabled. Do not mock Prisma for repository tests.
- Every new tenant-owned table or repository function gets a case in `tests/integration/tenant-isolation.int.test.ts`.
- Time-dependent logic takes a `now` parameter or uses the injected clock. Never call `new Date()` inside `domain/`.
- E2E tests use the seeded demo tenant and must not depend on test order.

## Commits and PRs

- Conventional Commits: `feat(assessments): add ESR readiness rule`, `fix(documents): …`, `test(tenancy): …`, `docs: …`, `chore: …`.
- One milestone = one PR titled `M06: Scoring engine`. The body contains Before/After, a "How to try it" section and the test results.
- No secrets in the repo. Add new environment variables to `.env.example` with a comment.

## Security reminders

- Check permissions with `can()` in the service, never only in the UI.
- Issue signed URLs only after a permission check, and give them a TTL of 5 minutes or less.
- Raw SQL must run inside the tenant transaction wrapper (`withTenant`). Use `withSystem` only for platform-admin or cross-tenant work, and audit every write made through it.
- RLS policies, grants and triggers live in hand-written migration SQL (Prisma cannot express them). A new tenant-owned table needs its policy in the same migration.
- `withoutTenant()` is only for the `SECURITY DEFINER` lookups; `authDb()` only for `lib/auth.ts` and `modules/identity/repo.ts`.
- Pages get the user and facility from `requireAppContext()` and pass `ctx.access` to services. Never build an `AccessContext` from form input.
- Pages that read the session or search params render that part inside `<Suspense>` (Cache Components), and `generateMetadata` passes the locale to `getTranslations` explicitly.
- Do not log document contents or personal data.
