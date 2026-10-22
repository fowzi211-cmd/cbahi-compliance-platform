# Mustamir (مستمر) — continuous accreditation compliance

A bilingual (Arabic/English) web platform that helps Saudi healthcare facilities stay continuously
compliant with accreditation standards: before their first survey and between survey visits.

> **Standards content.** This repository contains **no** CBAHI, JCI or MOH standard text. The
> development database is seeded only with fictional `DEMO-*` placeholder standards. Real
> frameworks are imported at runtime under a licensed arrangement.

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Conventions for contributors and AI sessions: [`CLAUDE.md`](CLAUDE.md)

## Run locally

Requirements: Node.js 22+, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env
docker compose up -d      # PostgreSQL :5432, S3 storage :8333, Mailpit :1025 / UI :8025
pnpm install
pnpm db:setup             # database roles + migrations
pnpm db:seed              # fictional DEMO-AMB framework and the demo polyclinic (about a minute)
pnpm dev                  # http://localhost:3000
```

Then open http://localhost:3000, create an account and set up your organization. Owners and
quality managers must turn on two-step verification with an authenticator app (any TOTP app
works). Invitation emails land in Mailpit at http://localhost:8025.

The standards library is under **Standards library** in the menu. To import frameworks, make an
account a platform admin with `pnpm platform:admin you@example.com`, enrol two-step verification,
and open http://localhost:3000/ar/platform/standards. The file format is in
[docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md).

A new account goes from sign-up to the onboarding wizard (http://localhost:3000/ar/onboarding):
facility details and type, frameworks, element applicability, departments, team invitations and
the survey cycle. Each step can be changed later under **Settings**.

Local services:

| Service    | Purpose                                  | Address                                           |
| ---------- | ---------------------------------------- | ------------------------------------------------- |
| PostgreSQL | Main database                            | `localhost:5432` (user/pass `mustamir`)           |
| SeaweedFS  | S3-compatible storage, bucket `evidence` | `http://localhost:8333`                           |
| Mailpit    | Catches outgoing email                   | SMTP `localhost:1025`, UI `http://localhost:8025` |

Stop everything with `docker compose down` (add `-v` to wipe data).

## Try the demo polyclinic

`pnpm db:seed` also creates «مستوصف النور التجريبي» (Al-Noor Demo Polyclinic), a fictional
polyclinic on the Hybrid plan with five departments, a person for every role and six months of
history: self-assessments, weekly tracers, corrective actions, documents and a consultant's
mock survey. Its readiness climbs, dips when nursing slips, recovers, and ends "not ready"
because an ESR element lapsed last week. [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) tells the
whole story.

Everyone's password and email are in `.demo-credentials.json` (written by the seed, never
committed). `pnpm demo:code` prints them with the current authenticator code for the people who
need one, so you can sign in without an authenticator app:

```bash
pnpm demo:code            # everyone
pnpm demo:code quality    # just the quality manager
```

A walk through it, at http://localhost:3000:

1. **Dashboard.** Sign in as `quality@demo.mustamir.example` with the password and the code from
   `pnpm demo:code quality`. The dashboard shows "not ready", the lapsed ESR element, scores per
   chapter and department, one overdue action, the survey countdown and the six-month trend with
   the consultant's line. Switch to English from the header.
2. **History.** Open **Assessments** (four locked self-assessments), **Tracers** (four templates
   and their runs), **Findings** (filter by status) and **Documents** (a revised procedure and one
   waiting for approval).
3. **A tracer from a phone.** Open the browser's device toolbar, go to **Tracers** and start the
   weekly pharmacy tracer: one element per screen, then review and submit.
4. **Consultant.** Sign in as `consultant@demo.mustamir.example` and open **Mock surveys** to
   download the findings report in Arabic or English.
5. **Other roles.** `nursing.head@`, `pharmacy.head@`, `infection.head@`, `staff@` and `viewer@`
   (same domain) see what their role allows. `owner@` manages settings, people and the data export;
   `platform.admin@` opens http://localhost:3000/ar/platform.

The demo is not created when `NODE_ENV=production`. To start it again from scratch, wipe the
local data with `docker compose down -v`, then `docker compose up -d && pnpm db:setup && pnpm db:seed`.

## Tests and checks

```bash
pnpm check        # lint, typecheck, formatting, i18n parity, unit + integration tests
pnpm test:int     # integration tests on a real PostgreSQL (tenant isolation, audit log, auth)
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright, desktop + mobile viewports)
```

The first e2e run needs a browser: `pnpm exec playwright install chromium`. If a Chromium is
already installed elsewhere, point to it with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

CI (GitHub Actions) runs the same checks plus e2e on every pull request.
