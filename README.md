# Insurance SaaS Platform

Multi-agency white-label SaaS for insurance brokerage agencies. Replaces the legacy Inspro tooling. Phase 1 covers the broker admin experience: catalogue management, placement-slip ingestion, policy versioning, and publish workflow.

The architecture is **catalogue-as-data** — every insurer product is defined by JSON Schemas stored in the database. Adding a new product never requires a code deploy. See [`docs/architecture.md`](docs/architecture.md).

## Documents

- [`CLAUDE.md`](CLAUDE.md) — persistent context for Claude Code sessions. Read first.
- [`docs/PHASE_1_BUILD_PLAN_v2.md`](docs/PHASE_1_BUILD_PLAN_v2.md) — **canonical Phase 1 plan, 35 stories.** Supersedes the brief.
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — live story tracker.
- [`docs/ADRs/`](docs/ADRs/) — architectural decision records.
- [`docs/architecture.md`](docs/architecture.md) — dynamic product catalogue design (supporting context).
- [`docs/build_brief.md`](docs/build_brief.md) — historical brief, **superseded by v2**.
- [`docs/platform_plan.md`](docs/platform_plan.md) — broader platform context.
- [`docs/progress-log.md`](docs/progress-log.md) — running session log.

## Stack

Node.js 20 LTS · TypeScript strict · Next.js 15 App Router · PostgreSQL 16 · Prisma 5 · WorkOS AuthKit · Ajv · Zod · `@rjsf/core` · `json-logic-js` · `exceljs` · BullMQ · Biome · Vitest · Playwright · pnpm workspaces. Hosted on Azure Container Apps in `southeastasia` (Singapore PDPA data residency).

## Local development

Prerequisites:

- Node.js 20 LTS or newer (use `nvm use` if you have nvm).
- [Docker](https://docs.docker.com/get-docker/) running locally.
- pnpm — installed automatically via Corepack on first script run.

Bootstrap a fresh clone:

```bash
./scripts/dev-setup.sh
```

This script enables Corepack + pnpm, installs dependencies, brings up Postgres and Redis via Docker, generates the Prisma client, runs the seed (currently a no-op stub — populated across Stories S6/S7/S11/S16), and prints next steps.

Then start the app:

```bash
pnpm dev
```

The app runs at <http://localhost:3000>. During bootstrap (before authentication is wired up in Story S3) it shows a placeholder landing page.

## Common commands

```bash
pnpm dev             # run apps/web on :3000
pnpm typecheck       # tsc --noEmit across the workspace
pnpm lint            # Biome lint
pnpm format          # Biome format
pnpm test            # Vitest unit + integration
pnpm test:e2e        # Playwright end-to-end
pnpm build           # production build
pnpm prisma <cmd>    # Prisma CLI (e.g. `pnpm prisma studio`)
pnpm db:seed         # run prisma/seed.ts
```

## Repository layout

See [`docs/PHASE_1_BUILD_PLAN_v2.md`](docs/PHASE_1_BUILD_PLAN_v2.md) for the canonical structure. Top level:

```
apps/web/                      Next.js 15 app
packages/catalogue-schemas/    seed JSON Schemas (populated in S16)
packages/shared-types/         shared TypeScript types
prisma/                        Prisma schema, migrations, seed
infra/bicep/                   Azure IaC (populated in S1)
scripts/                       dev-setup, codegen
docs/                          plan, ADRs, runbooks, progress
reference/                     read-only placement slips and screenshots
```

## Status

Bootstrap + v2 migration complete — Prisma schema reflects v2, ADRs 0001/0002 in place, `docs/PROGRESS.md` tracks the 35 stories. No migrations applied yet, no auth. **Story S1 (Bicep + remaining CI/CD pieces) is next.**
