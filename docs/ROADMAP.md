# MVP Roadmap

> Status: **Approved** by the owner on 2026-10-19.
> Each milestone is small enough to build, test and review in one working session. Each one ends with tests passing, a short "how to try it" note, and one PR (`mNN-short-name` branch) that the owner merges.

Legend: **DoD** = done when. All UI work is delivered in Arabic (default, RTL) and English.

## Foundation

**M0 — Repo skeleton and tooling**
Next.js + TypeScript strict, pnpm, ESLint (with a module-boundary rule) and Prettier, Vitest, Playwright, docker-compose (postgres, seaweedfs S3, mailpit), `.env.example`, a GitHub Actions CI pipeline, README "run locally".
_DoD:_ `docker compose up -d && pnpm dev` serves a page. CI runs lint, typecheck and tests green.

**M1 — i18n, RTL shell and design system**
next-intl with `/ar` and `/en`, `dir` handling, fonts, a logical-property Tailwind setup, shadcn/ui base components, an app shell (sidebar, top bar, locale switch), date utilities (Riyadh timezone, optional Umm al-Qura Hijri), and a CI check for message-key parity.
_DoD:_ the shell mirrors correctly in RTL. Date-utility unit tests pass. The axe check passes on the shell.

**M2 — Database, tenancy core and isolation**
Prisma schema for Tenant, Facility, Department, User, Membership and Subscription. A `TenantContext` and tenant-scoped repository pattern. RLS policies, a non-owner DB role, and the `set_config` transaction wrapper. An audit-log table with a no-update/no-delete trigger and a hash chain.
_DoD:_ the integration isolation suite passes (two tenants, no cross reads or writes, including raw SQL). An audit-chain verification test passes.

**M3 — Auth, RBAC and invitations**
Better Auth (email+password and TOTP), MFA required for privileged roles, sessions and lockout, the `can(ctx, action, resource)` policy with its full matrix test, and email invitations into a facility role.
_DoD:_ the policy matrix tests pass. An e2e test covers sign-up → MFA → invite user → user accepts with the right role.

## Standards and assessment

**M4 — Standards library and import**
Framework, Chapter, Standard, Element, ScoringScale and ScoreLevel models, plus `rollup_config`. A CSV/JSON/XLSX importer with validation, preview and draft → active editions. `docs/IMPORT_FORMAT.md`. A seed with the **DEMO-AMB** fictional framework (around 8 chapters, around 60 elements, about 10 of them ESR). A browse UI by chapter and department with ESR items first and highlighted.
_DoD:_ importer unit tests (valid file, row errors, edition diff) pass. The demo framework is browsable in both languages.

**M5 — Onboarding wizard**
Create facility → choose facility type → applicable frameworks and elements load automatically → N/A overrides with justification → define departments → invite users → set the survey cycle.
_DoD:_ an e2e test of the full wizard in Arabic. Applicability-filter unit tests pass.

**M6 — Scoring engine (pure domain)**
Element rules (evidence required, NA rules, ESR levels), configurable roll-up methods, readiness status, score expiry, and `ElementStatus` updates on submit. No UI beyond what testing needs.
_DoD:_ an exhaustive unit test suite for scoring, roll-up, ESR "Not ready", expiry and readiness thresholds.

**M7 — Self-assessment UI**
Create an assessment (whole facility or one department), score elements with comments and evidence (documents are links only until M8; observation, interview, record review and KPI notes), save progress, submit and lock. Findings are auto-generated from NM and PM.
_DoD:_ an e2e test where a quality manager completes a department assessment. Readiness updates. Findings are created.

## Evidence and follow-up

**M8 — Document control**
Upload to S3 (through the server, so files are scanned before they are stored; downloads through signed URLs, see ARCHITECTURE §3.4), versioning, SHA-256, a PHI attestation and scanner, an approval workflow, effective/review/expiry dates, linking to elements, and using approved versions as score evidence.
_DoD:_ PHI-scanner unit tests pass. An e2e test covers upload → approve → link → cite in a score → new version. An isolation test confirms signed URLs are never issued across tenants.

**M9 — Findings and CAPA**
A findings list, CAPA items (owner, due date, status), closure that requires evidence, an escalation schedule, and finding verification by a later MET.
_DoD:_ CAPA state-machine and escalation unit tests pass. An e2e test runs a finding through to verified closure.

**M10 — Jobs and notifications**
A pg-boss worker. The notification service with in-app (bell and inbox) and email channels, plus SMS and WhatsApp stubs. Jobs for document review and expiry reminders, CAPA overdue escalation and a daily digest. Locale-aware templates.
_DoD:_ job unit tests use a fake clock. Mailpit receives Arabic and English emails. The in-app inbox works.

**M11 — Tracers (mobile-first)**
Tracer templates (department, pool, sample size, frequency), weighted-random sampling with the seed stored, a phone-optimized run screen (one element per screen, large tap targets, works on 3G), and results that feed `ElementStatus`.
_DoD:_ sampling unit tests (distribution and determinism with the seed) pass. A Playwright mobile-viewport e2e test passes.

**M12 — Committees and meeting minutes**
Committees, meetings, minutes stored as documents, and links to the elements they oversee.
_DoD:_ CRUD e2e passes. Minutes count as evidence on the linked elements.

## Visibility

**M13 — Snapshots and dashboards**
A nightly `ComplianceSnapshot` job. A readiness overview: compliance % by chapter and department, an ESR status panel with a "Not ready" banner, open and overdue CAPA items, documents expiring soon, and expired or unverified elements. A trend chart (internal vs consultant series). A survey countdown.
_DoD:_ snapshot job tests pass. The dashboard renders seeded data in both languages. axe passes.

**M14 — Tiers, consultants and service requests**
The feature-gate matrix, a super-admin tier assignment screen, consultant assignment to Hybrid facilities, a service-request ticket flow, and the struggle signal with an in-app offer.
_DoD:_ feature-gate and struggle-signal unit tests pass. An e2e test shows a consultant can reach only their assigned facility.

**M15 — Mock survey mode and PDF report**
Mock-survey assessments (consultant or internal), lock, and a formal findings report rendered as Arabic and English PDFs via Playwright, stored as a tenant document.
_DoD:_ an e2e test where a consultant runs a mock survey and exports both PDFs. A visual snapshot test of the report passes.

**M16 — Audit log UI and hardening**
An audit log viewer with filters, a chain-verification command, security headers and CSP, rate limits, a session timeout pass, and data export per tenant.
_DoD:_ header and rate-limit tests pass. The chain-verify command exits 0 on seeded data.

## Definition of done for the MVP

**M17 — Demo tenant and final acceptance**
A seed for "Al-Noor Demo Polyclinic" (fictional), with 5 departments, users for every role, and **6 months of back-dated history** (self-assessments, weekly tracers, CAPA items, documents, one consultant mock survey). The trend shows dips and recovery. A Playwright acceptance suite covers brief §11 in Arabic and English. README walkthrough.
_DoD:_ every item in brief §11 is demonstrated by an automated test, and all tests pass.

## Phase 2 (designed for, not scheduled)

KPI tracking with run charts · staff credentialing (SCFHS, BLS/ACLS) · incident reporting · CBAHI/JCI/MOH crosswalk · anonymous benchmarking (k ≥ 5) · an AI guidance assistant using our own guidance content only · seasonal (Hajj) facilities with time-bounded cycles · SMS and WhatsApp channels · a payment gateway (Moyasar or HyperPay) · production deployment in a KSA region.
