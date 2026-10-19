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
pnpm dev                  # http://localhost:3000
```

Local services:

| Service    | Purpose                                  | Address                                           |
| ---------- | ---------------------------------------- | ------------------------------------------------- |
| PostgreSQL | Main database                            | `localhost:5432` (user/pass `mustamir`)           |
| SeaweedFS  | S3-compatible storage, bucket `evidence` | `http://localhost:8333`                           |
| Mailpit    | Catches outgoing email                   | SMTP `localhost:1025`, UI `http://localhost:8025` |

Stop everything with `docker compose down` (add `-v` to wipe data).

## Tests and checks

```bash
pnpm check        # lint, typecheck, formatting, i18n parity, unit + integration tests
pnpm test:int     # integration tests on a real PostgreSQL (tenant isolation, audit log)
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright, desktop + mobile viewports)
```

The first e2e run needs a browser: `pnpm exec playwright install chromium`. If a Chromium is
already installed elsewhere, point to it with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

CI (GitHub Actions) runs the same checks plus e2e on every pull request.
