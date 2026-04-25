# CLAUDE.md

Persistent context for Claude Code working in this repository. Read this first on every session before writing code.

## What this is

A multi-agency white-label SaaS platform for insurance brokerage agencies. Brokers ingest placement slips (Excel workbooks) from insurers, manage structured policy data via a metadata-driven product catalogue, and publish versioned configurations ready for employee-facing consumption (employee portal is Phase 2, not in this repo yet). Replaces an older system called Inspro.

The single most important design idea: **the product catalogue is data, not code.** Every insurer product (GTL, GHS, GPA, and so on) is defined by a JSON Schema stored in the database. Product instances are JSONB validated against that schema on every write. Adding a new product never requires a code deploy. If you catch yourself writing product-specific `if` branches in application code, stop — extend the catalogue instead.

Full architectural reasoning lives in `docs/architecture.md` (derived from `dynamic_product_architecture.md`). The Phase 1 build plan lives in `docs/build_brief.md`. Both are authoritative; this file is the day-to-day companion.

## Stack

Node.js 20 LTS, TypeScript strict. Next.js 15 with App Router as a single full-stack app. PostgreSQL 16 via Prisma 5. WorkOS AuthKit for authentication, with WorkOS Organizations mapped one-to-one onto our `Agency` entity (multi-tenancy). Ajv for JSON Schema validation, Zod for API input validation, `@rjsf/core` for auto-generating admin forms from catalogue schemas, `json-logic-js` for benefit group eligibility predicates, `exceljs` for placement slip parsing, BullMQ with Azure Redis for background jobs. Biome for linting and formatting. Vitest for unit and integration tests, Playwright for end-to-end. pnpm for package management.

Hosting: GitHub for source and CI, Azure Container Apps for runtime, Azure Database for PostgreSQL Flexible Server, Azure Cache for Redis, Azure Blob Storage for uploaded files, Azure Key Vault for secrets, Application Insights for observability. All resources in `southeastasia` region for Singapore PDPA data residency.

## Repo layout

```
apps/web/              Next.js app
  src/app/             App Router routes
    (auth)/            sign-in, callbacks
    (admin)/           broker admin surfaces, tenant-scoped
    api/               route handlers
  src/server/          server-only code
    auth/              WorkOS integration
    db/                Prisma client + tenant helpers
    catalogue/         ProductType logic, schema validation
    ingestion/         Excel parser, template engine
    policies/          lifecycle, publish workflow
    storage/           Azure Blob client
    jobs/              BullMQ workers
    tenant/            middleware + scoping helpers
  src/components/      React components
  src/lib/             shared client+server utilities
  tests/               unit, integration, e2e
packages/catalogue-schemas/   seed JSON Schemas (GHS, GTL, GPA, …)
packages/shared-types/        shared TS types
prisma/                schema + migrations + seed
infra/bicep/           Azure IaC
scripts/               dev bootstrap, codegen
docs/                  architecture, build brief, ADRs
```

## Commands

```
pnpm install                    install dependencies
./scripts/dev-setup.sh          bootstrap local environment (Docker Postgres + Redis, migrations, seed)
pnpm dev                        run app at localhost:3000
pnpm test                       run Vitest unit + integration
pnpm test:e2e                   run Playwright end-to-end
pnpm lint                       Biome lint
pnpm format                     Biome format
pnpm typecheck                  tsc --noEmit across workspace
pnpm prisma migrate dev         create + apply a new migration
pnpm prisma studio              open Prisma Studio to browse DB
pnpm prisma db seed             run prisma/seed.ts
pnpm build                      production build
```

Always run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR. CI will run the same.

## Conventions

**TypeScript.** Strict mode, no `any` (use `unknown` or specific types), prefer discriminated unions over optional fields, readonly arrays and objects where they don't mutate.

**File naming.** Kebab-case for files (`product-type-service.ts`), PascalCase for React components (`CatalogueBrowser.tsx`), camelCase for variables and functions.

**Server vs client.** Default to server components. Mark client components explicitly with `"use client"`. Data fetching happens in server components or server actions; client components receive props.

**Data access.** Prisma for all database access. Never write raw SQL except in rare performance-driven cases, which must come with a comment explaining why and an ADR under `docs/ADRs/`.

**Tenant scoping.** Every tenant-scoped Prisma query goes through `requireAgencyContext()` which returns an agency-scoped client. A Prisma middleware rejects queries on tenant-scoped tables that lack an `agency_id` filter — bypass is not possible. If a query genuinely needs cross-tenant read (like platform-level admin dashboards), use `__requireServiceContext()` explicitly and log its use.

**API routes.** Every server action and route handler:
  1. Resolves the agency context from the session (via `requireAgencyContext()`).
  2. Validates input with Zod (define the schema alongside the handler).
  3. Returns typed results; errors as discriminated unions, not thrown exceptions, unless the caller has to crash (validation errors don't; programming errors do).

**Validation layers.** Two distinct validators, do not conflate:
  - Zod validates API input (the shape of what a user submitted).
  - Ajv validates catalogue JSONB against product type JSON Schemas (the insurance-domain rules).

**Forms.** Admin forms are generated from catalogue JSON Schemas via `@rjsf/core`. Do not hand-write forms for product-specific data. Hand-written forms are only for metadata (a Client's name and UEN, a User's profile, an Insurer's label).

**Error handling.** Server-side errors log with structured context (agency id, user id, request id, action). Client-side error boundaries present a friendly message and a reference id. Never expose raw error messages to end users.

**Tests.** Every server module has unit tests. Every server action has at least one integration test hitting a real Postgres (via testcontainers or a dedicated test DB). Every critical admin workflow has at least one Playwright test. Tests live next to their source (`foo.ts` next to `foo.test.ts`) for unit, under `tests/integration` and `tests/e2e` for the others.

**Migrations.** One migration per logical change. Migration names are descriptive (`add_product_type_version_immutability_trigger`, not `update_schema`). Destructive migrations in production require a separate data migration + application deploy pair.

**Commits.** Conventional Commits. Small, focused, one concern per commit. PR titles match the commit type (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Architecture principles

**The catalogue is data.** If you need to special-case a product in application code, the special case belongs in the catalogue — extend the JSON Schema, update the ingestion template, update the display template. Application code stays product-agnostic.

**Tenant isolation is absolute.** Every query filters by `agency_id`. Every JSONB field is agency-scoped. No exceptions without an ADR.

**Versions are immutable.** A published `ProductTypeVersion` or `PolicyVersion` cannot be mutated. Changes produce new versions. Old instances continue to validate against their original version until explicitly migrated.

**Validate on write, trust on read.** Every write of JSONB data validates against its catalogue schema. Reads skip validation — the data is trusted because every write gate enforced it. This is what makes the system fast at scale.

**Ingestion never silently drops data.** If the parser can't match a row to a catalogue field, it flags the row for manual review. Silent drops are bugs.

**Publish is a state transition, not a copy.** Publishing doesn't duplicate data — it transitions a `PolicyVersion` from `draft` to `published`, and if another version exists in `published`, that one atomically becomes `superseded`. The data is the same rows; their status changes.

## Things to never do

- Hardcode product-specific logic (`if (product === "GHS") ...`).
- Mutate a published `ProductTypeVersion` or `PolicyVersion`.
- Bypass `requireAgencyContext()` for "convenience" on tenant-scoped reads.
- Skip Ajv validation on JSONB writes for "speed" — always validate.
- Store secrets in code, env files committed to git, or Prisma seed scripts. Everything sensitive goes in Key Vault.
- Catch-and-ignore errors. Either handle them meaningfully or let them propagate with context.
- Modify migrations that have been applied to any environment beyond local dev. Create a new migration instead.
- Use raw SQL without an ADR justifying it.
- Add a library without considering maintenance overhead. Check: is it actively maintained, well-typed, secure, and does Biome lint its outputs?
- Copy-paste placement slip values between product instances. Use the seed script or the UI. Copy-pasted data skips validation.

## Common tasks

**Adding a new product type to the catalogue.** Do it through the catalogue admin UI, not through code. The seed script is only for dev bootstrap. If you must add via code (migration, for example), create a Prisma seed script that calls the same server action the admin UI uses — never bypass the validation path.

**Changing an existing product type's schema.** Publish a new version. Do not mutate the existing version. Old instances continue to reference the old version. Write a migration function if instances need to upgrade.

**Adding a new field to a relational core table.** Prisma migration, update dependent TypeScript types, update seed if needed, update tests.

**Adding a new route.** Create under `apps/web/src/app/(admin)/`. Add to the side nav if user-facing. Protect via the existing `(admin)` layout — do not re-implement auth per route.

**Adding a new background job.** Define in `apps/web/src/server/jobs/`. Register the worker. Queue from server actions via a typed helper. Every job has retry policy and dead-letter behaviour.

**Reading placement slip data.** Use the existing parser service in `apps/web/src/server/ingestion/`. Parser driven by ingestion templates from the catalogue. Do not write product-specific parser code.

**Testing code that uses the database.** Spin up a Postgres via testcontainers in the test setup. Wrap each test in a transaction that rolls back on teardown.

**Working with Azure resources.** Everything goes through Bicep. Do not create resources via portal or CLI without capturing them in Bicep after.

## When stuck

Check the two reference docs first — `docs/architecture.md` and `docs/build_brief.md`. If the question is architectural and the docs don't answer it, write an ADR proposing an answer, tag it `status: proposed`, and ask the human. If it's tactical (a library quirk, a type error), search the codebase for similar patterns, then search the web, then ask.

Never silently invent behaviour. If a requirement is ambiguous, ask. If you made an assumption to keep moving, leave a `// TODO(assumption):` comment and flag it in the PR description.

## Things that will probably confuse you

**WorkOS Organizations.** A WorkOS Organization is our `Agency`. A WorkOS User is our `User`, linked to exactly one Agency. Do not assume a User can belong to multiple Agencies — Phase 1 says one per user. The Agency model stores a `workos_organization_id` column for the mapping.

**Four JSON Schemas per product type.** `schema_product`, `schema_plan`, `schema_schedule`, `schema_rate`. They describe different slices of a product and are validated separately. A single product instance has all four populated in separate JSONB columns.

**Ingestion template versus display template.** Ingestion is how to parse Excel *into* the shape. Display is how to render the shape *to* users (Phase 2 surface-area; minimal templates in Phase 1). Both live in the ProductTypeVersion alongside the schemas.

**Benefit groups use JSONLogic, not a custom DSL.** Predicates are JSONLogic JSON. Evaluator is `json-logic-js`. Do not invent a DSL — keep in step with a standard format that has implementations in every language we might need downstream.

**Policy, PolicyVersion, Product — three different things.** A `Policy` is the abstract policy (one per insurer per holding entity per line of business). A `PolicyVersion` is a specific draft or published configuration for a benefit year. A `Product` is an instance of a catalogue ProductType under that PolicyVersion. The hierarchy is Agency > Client > PolicyHoldingEntity > Policy > PolicyVersion > Product > {Plans, PremiumRates, BenefitSchedule, BenefitGroupEligibility}.

---

Update this file whenever a convention solidifies or a recurring confusion appears. It is the first thing a fresh Claude Code session reads, and it should reflect reality.
