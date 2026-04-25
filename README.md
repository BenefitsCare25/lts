# LTS — Insurance brokerage platform

Multi-agency, white-label SaaS for insurance brokerage agencies. Brokers ingest
placement slips, manage structured policy data via a metadata-driven product
catalogue, and publish versioned configurations.

This repository is the Phase 1 build (broker admin surfaces). The employee
portal is Phase 2 and lives elsewhere.

> Read [`CLAUDE.md`](./CLAUDE.md) before contributing — it captures
> conventions, layout, and pitfalls. The architecture deep-dive lives at
> [`docs/architecture.md`](./docs/architecture.md); the Phase 1 build plan is
> [`docs/build_brief.md`](./docs/build_brief.md).

## Quick start

Prereqs: Node 20 LTS, pnpm 9+, Docker Desktop.

```sh
git clone <repo-url> lts
cd lts
./scripts/dev-setup.sh
pnpm dev
```

`./scripts/dev-setup.sh` brings up Postgres 16 + Redis 7 in Docker, syncs the
Prisma schema, and seeds a small dev dataset. After it exits cleanly, the
app is reachable at <http://localhost:3000>.

## Layout

```
apps/web/                 Next.js 15 (App Router) — the broker admin app
packages/catalogue-schemas/  Seed JSON schemas for the product catalogue
packages/shared-types/        Cross-package TS types
prisma/                    Prisma schema, migrations, seed
scripts/                   dev bootstrap and codegen helpers
docs/                      Architecture, build brief, ADRs
infra/bicep/               Azure IaC (lands in S1)
.github/workflows/         CI/CD pipelines
```

## Common commands

```sh
pnpm dev                       # run the web app at :3000
pnpm test                      # vitest (unit + integration)
pnpm test:e2e                  # playwright
pnpm typecheck                 # tsc across the workspace
pnpm lint                      # biome check
pnpm format                    # biome format --write
pnpm prisma migrate dev        # create + apply a new migration
pnpm prisma studio             # browse the DB
pnpm prisma db seed            # rerun the seed
```

## Status

Phase 1 scaffold complete (build brief §5). Story S1 begins next.
