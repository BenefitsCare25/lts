# CLAUDE.md

Persistent context for Claude Code working in this repository. Read this first on every session before writing code.

## What this is

A multi-agency white-label SaaS platform for insurance brokerage agencies. Brokers ingest placement slips (Excel workbooks) from insurers, manage structured policy data via a metadata-driven product catalogue, and publish versioned configurations ready for employee-facing consumption (employee portal is Phase 2, not in this repo yet). Replaces an older system called Inspro.

The single most important design idea: **the product catalogue is data, not code.** Every insurer product (GTL, GHS, GPA, and so on) is defined by a JSON Schema stored in the database. Product instances are JSONB validated against that schema on every write. Adding a new product never requires a code deploy. If you catch yourself writing product-specific `if` branches in application code, stop — extend the catalogue instead.

## Phase 1 plan (canonical)

The current Phase 1 plan is **`docs/PHASE_1_BUILD_PLAN_v2.md`**. It supersedes `docs/build_brief.md` — if anything in the brief or `docs/architecture.md` conflicts with the v2 plan, the v2 plan wins. The brief is kept as historical reference only; do not start a story from it.

Read order at the start of every session:

1. This file (`CLAUDE.md`).
2. `docs/PHASE_1_BUILD_PLAN_v2.md` — the plan (sections 1–3 for orientation, then your story's section).
3. `docs/PROGRESS.md` — what's done, what's next.
4. Any `proposed`-status ADR under `docs/ADRs/` — pending decisions you may need to honour.

## Stack

Node.js 22 LTS, TypeScript strict. Next.js 15 with App Router as a single full-stack app. PostgreSQL 16 via Prisma 5. WorkOS AuthKit for authentication, with WorkOS Organizations mapped one-to-one onto our `Tenant` entity (multi-tenancy). Ajv for JSON Schema validation, Zod for API input validation, `@rjsf/core` for auto-generating admin forms from catalogue schemas, `json-logic-js` for benefit group eligibility predicates, `exceljs` for placement slip parsing, BullMQ with Azure Redis for background jobs. Biome for linting and formatting. Vitest for unit and integration tests, Playwright for end-to-end. pnpm for package management.

Hosting: GitHub for source and CI, Azure Container Apps for runtime, Azure Database for PostgreSQL Flexible Server, Azure Cache for Redis, **SharePoint (via Microsoft Graph + ROPC delegated auth) for uploaded files** — same pattern as sister-project PAD; the lib lives at `apps/web/src/server/storage/sharepoint.ts`. Azure Key Vault for secrets, Application Insights (workspace-based, backed by Log Analytics) for observability. All resources in `southeastasia` region for Singapore PDPA data residency.

AI extraction layer (placement-slip → catalogue JSON) is **BYOK per tenant** — each tenant supplies their own Azure AI Foundry endpoint + deployment + key via the `/admin/settings/ai-provider` UI. The platform never holds a shared LLM key; instead it stores per-tenant credentials encrypted at rest with AES-256-GCM (`apps/web/src/server/security/secret-cipher.ts`, master key from `APP_SECRET_KEY` env). Plaintext keys never leave server memory and are never logged.

## Repo layout

```
apps/web/              Next.js app
  src/app/             App Router routes
    (auth)/            sign-in, callbacks
    admin/             broker admin surfaces, tenant-scoped
      settings/        tenant-level config (ai-provider, …)
    api/               route handlers
  src/server/          server-only code
    auth/              session helpers (Auth.js for Phase 1)
    db/                Prisma client + tenant helpers
    catalogue/         ProductType logic, schema validation (Ajv singleton)
    ingestion/         Excel parser + AI extraction pipeline
    policies/          lifecycle, publish workflow
    security/          app-level encryption (secret-cipher.ts)
    storage/           SharePoint client (sharepoint.ts)
    jobs/              BullMQ workers
    tenant/            middleware + scoping helpers
    trpc/              router composition + role guards
  src/components/      React components
    ui/                centralised primitives (ScreenShell, Breadcrumbs,
                       Card, Field, ConfidenceBadge, Form). New screens
                       MUST consume these instead of inventing layouts.
  src/lib/             shared client+server utilities
  tests/               unit, integration, e2e
docker/                container entrypoint scripts
packages/catalogue-schemas/   seed JSON Schemas (GHS, GTL, …) + extracted-product.json
packages/shared-types/        shared TS types
prisma/                schema + migrations + seed
infra/bicep/           Azure IaC (modules: container-app, postgres, redis,
                       app-insights, log-analytics, container-registry, …)
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

Always run `pnpm typecheck && pnpm lint && pnpm test` before pushing. CI will run the same on every push to `main` and gate the staging deploy.

## Conventions

**TypeScript.** Strict mode, no `any` (use `unknown` or specific types), prefer discriminated unions over optional fields, readonly arrays and objects where they don't mutate.

**File naming.** Kebab-case for files (`product-type-service.ts`), PascalCase for React components (`CatalogueBrowser.tsx`), camelCase for variables and functions.

**Server vs client.** Default to server components. Mark client components explicitly with `"use client"`. Data fetching happens in server components or server actions; client components receive props.

**Data access.** Prisma for all database access. Never write raw SQL except in rare performance-driven cases, which must come with a comment explaining why and an ADR under `docs/ADRs/`.

**Tenant scoping.** Every tenant-scoped Prisma query goes through `requireTenantContext()` which returns a tenant-scoped client. A Prisma middleware rejects queries on tenant-scoped tables that lack a `tenantId` filter — bypass is not possible. Postgres row-level security policies enforce the same boundary at the database layer (defence-in-depth). If a query genuinely needs cross-tenant read (like platform-level admin dashboards), use `__requireServiceContext()` explicitly and log its use.

**API routes.** Every server action and route handler:
  1. Resolves the tenant context from the session (via `requireTenantContext()`).
  2. Validates input with Zod (define the schema alongside the handler).
  3. Returns typed results; errors as discriminated unions, not thrown exceptions, unless the caller has to crash (validation errors don't; programming errors do).

**Validation layers.** Three distinct validators, do not conflate:
  - Zod validates API input (the shape of what a user submitted).
  - Ajv validates catalogue JSONB against `ProductType.schema` and `ProductType.planSchema` (the insurance-domain rules).
  - Ajv also validates AI-extracted JSON against `packages/catalogue-schemas/extracted-product.json` (the LLM output contract — every leaf must be `{value, raw, confidence, sourceRef}`).

**Secrets at rest.** Tenant-supplied secrets (Azure AI Foundry keys today; future BYOK creds) are encrypted with AES-256-GCM via `apps/web/src/server/security/secret-cipher.ts`. The master key comes from `APP_SECRET_KEY` (Container App secret in prod, `.env.local` in dev — set with `openssl rand -base64 48`). The cipher format is `v1.<base64url(iv ‖ ciphertext ‖ authTag)>` so we can rotate later without breaking old rows. Never log plaintext keys, never persist them outside the encrypted column, and never echo them back from a tRPC procedure — `getMasked` returns `keyLastFour` only.

**Forms.** Admin forms are generated from catalogue JSON Schemas via `@rjsf/core` for product-specific data. Hand-written forms are only for metadata (Client name + UEN, User profile, Insurer label, AI provider config) — and those use the `<Form>` + `<Field>` primitives in `apps/web/src/components/ui/` (react-hook-form + Zod under the hood). Do not invent a third form pattern; do not roll `useState`-driven forms in new code.

**UI primitives.** Every new admin screen consumes the `components/ui/` layer: `<ScreenShell>` for header + content padding, `<Breadcrumbs>` (auto-rendered in `admin/layout.tsx`, do not duplicate per page), `<Card>` for surfaces, `<Field>` for labelled inputs, `<ConfidenceBadge>` for AI-extraction confidence chips, `<Form>` for hand-written forms. Spacing comes from utility classes (`gap-*`, `mb-*`, `p-*`, `flex`, `items-center`, `justify-between`) mapped to `--space-*` tokens — do not reach for inline `style={{}}`.

**Error handling.** Server-side errors log with structured context (tenant id, user id, request id, action). Client-side error boundaries present a friendly message and a reference id. Never expose raw error messages to end users.

**Tests.** Every server module has unit tests. Every server action has at least one integration test hitting a real Postgres (via testcontainers or a dedicated test DB). Every critical admin workflow has at least one Playwright test. Tests live next to their source (`foo.ts` next to `foo.test.ts`) for unit, under `tests/integration` and `tests/e2e` for the others.

**Migrations.** One migration per logical change. Migration names are descriptive (`add_product_type_version_immutability_trigger`, not `update_schema`). Destructive migrations in production require a separate data migration + application deploy pair. Every new tenant-scoped table MUST also include its RLS policy in the same migration — see `20260428100000_extend_rls/migration.sql` for the canonical pattern. The container's `docker/entrypoint.sh` runs `prisma migrate deploy` before `next start` on every revision boot, so a pushed migration auto-applies on the next deploy and a broken migration fails-fast (Container Apps rolls back the bad revision automatically).

**Commits.** Conventional Commits, pushed directly to `main`. Small, focused, one concern per commit. The first line is the changelog entry; only use a body when the *why* needs more space. Run the full local check suite (`pnpm typecheck && pnpm check && pnpm test && pnpm build`) before every push — there is no PR review gate.

## Architecture principles

**The catalogue is data.** If you need to special-case a product in application code, the special case belongs in the catalogue — extend the JSON Schema, update the ingestion template, update the display template, or pick a different `premiumStrategy`. Application code stays product-agnostic.

**Tenant isolation is absolute.** Every query filters by `tenantId`. Every JSONB field is tenant-scoped. Postgres RLS is the second line of defence. No exceptions without an ADR.

**Versions are immutable.** A published `ProductType` version or a `PUBLISHED` `BenefitYear` cannot be mutated. Changes produce new versions. Old instances continue to validate against their original version until explicitly migrated.

**Validate on write, trust on read.** Every write of JSONB data validates against its catalogue schema. Reads skip validation — the data is trusted because every write gate enforced it. This is what makes the system fast at scale.

**Ingestion never silently drops data.** If the parser can't match a row to a catalogue field, it flags the row for manual review. Silent drops are bugs.

**Publish is a state transition, not a copy.** Publishing doesn't duplicate data — it transitions a `BenefitYear` from `DRAFT` to `PUBLISHED`, locks `Policy.versionId` for optimistic concurrency, and writes an `AuditLog` row. The data is the same rows; their status changes.

## Things to never do

- Hardcode product-specific logic (`if (product === "GHS") ...`).
- Mutate a published `ProductType` version or a `PUBLISHED` `BenefitYear`.
- Bypass `requireTenantContext()` for "convenience" on tenant-scoped reads.
- Skip Ajv validation on JSONB writes for "speed" — always validate.
- Store secrets in code, env files committed to git, or Prisma seed scripts. Everything sensitive goes in Key Vault, the Container App secret bag (referenced via `secretref:`), or — for tenant-supplied secrets — the AES-256-GCM column via `secret-cipher`.
- Rotate `APP_SECRET_KEY` without a re-encryption migration — every existing `TenantAiProvider.encryptedKey` row will become undecryptable. Treat it as a one-time-set value.
- Provision Azure resources via the portal or CLI without backing them up in Bicep — the next full Bicep deploy will diverge or worse, drop your manually-set Container App secrets.
- Render hardcoded back-link eyebrows (`<p className="eyebrow"><Link>← X</Link></p>`) in admin screens — `<Breadcrumbs>` is rendered once in `admin/layout.tsx` and handles navigation.
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

**Working with Azure resources.** Everything goes through Bicep. Do not create resources via portal or CLI without capturing them in Bicep after. The deploy workflow (`.github/workflows/ci.yml`) takes the **fast path** (image-only update) when `infra/` is unchanged, and the **full Bicep path** when any file under `infra/` changes — be deliberate about which one you're triggering. Required GitHub Actions secrets are listed at the top of `ci.yml`; missing secrets surface as Bicep param defaults of `''` which omit the corresponding Container App secret/env var.

**Adding a tenant-supplied secret.** New BYOK feature? Add it to the `TenantAiProvider` model only if it shares the AI Foundry shape; otherwise model a sibling `Tenant<X>Credential` table with `encryptedKey: String` + `keyLastFour: String @db.VarChar(4)` columns and the same RLS policy. Always go through `encryptSecret()` / `decryptSecret()` — never store plaintext. Expose a `getMasked` query that returns `keyLastFour` only, an `upsert`/`clear` mutation pair on `adminProcedure`, and a `test` mutation that decrypts in-memory and exercises the live API. The `apps/web/src/server/trpc/routers/tenant-ai-provider.ts` router is the canonical template.

## When stuck

Check `docs/PHASE_1_BUILD_PLAN_v2.md` first — it's the canonical plan. `docs/architecture.md` is supporting context (treat it as superseded where it disagrees with v2). If the question is architectural and the v2 plan doesn't answer it, write an ADR under `docs/ADRs/NNNN-short-title.md` proposing an answer, tag it `status: proposed`, and ask the human. If it's tactical (a library quirk, a type error), search the codebase for similar patterns, then search the web, then ask.

Never silently invent behaviour. If a requirement is ambiguous, ask. If you made an assumption to keep moving, leave a `// TODO(assumption):` comment and flag it in the commit body and the next progress-log entry.

## Things that will probably confuse you

**WorkOS Organizations.** A WorkOS Organization is our `Tenant`. A WorkOS User is our `User`, linked to exactly one Tenant. Do not assume a User can belong to multiple Tenants — Phase 1 says one per user. The Tenant model stores no WorkOS column directly — the mapping is by `slug` to organization metadata, and `User.workosUserId` carries the WorkOS user identifier.

**Two JSON Schemas per product type, plus a strategy code.** `ProductType.schema` covers the product-instance fields; `ProductType.planSchema` covers plan rows (including `stacksOn` and `selectionMode`). `ProductType.premiumStrategy` is a string code (e.g. `per_group_cover_tier`) that picks one of the strategy modules under `apps/web/src/server/premium-strategies/` — premium math is code, not catalogue data.

**Ingestion template versus display template.** Ingestion (`ProductType.parsingRules`) is how to parse Excel *into* the catalogue shape. Display (`ProductType.displayTemplate`) is how to render the shape *to* users (minimal in Phase 1; primary surface for Phase 2). Both live on the `ProductType` row alongside the schemas.

**Benefit groups use JSONLogic, not a custom DSL.** `BenefitGroup.predicate` is a JSONLogic JSON expression. Evaluator is `json-logic-js`. Do not invent a DSL — keep in step with a standard format that has implementations in every language we might need downstream.

**Six metadata registries drive every dropdown.** Global Reference (Country/Currency/Industry), Insurer Registry, TPA Registry, Pool Registry, Product Catalogue, Operator Library, and the per-tenant Employee Schema. None of these dropdowns are hardcoded in UI code. See v2 plan §1.2 and §3 for sources of truth.

**Policy, BenefitYear, Product, Plan — four different things.** A `Policy` is the abstract policy. A `BenefitYear` is a specific draft or published configuration for a benefit year (`DRAFT` / `PUBLISHED` / `ARCHIVED`). A `Product` is an instance of a `ProductType` under that `BenefitYear`. A `Plan` is one option within a Product (and may stack on another via `stacksOn`). The hierarchy is Tenant > Client > Policy > BenefitYear > Product > {Plans, PremiumRates, ProductEligibility}, with `PolicyEntity` rows sitting under Policy for multi-entity master policies (e.g. STM's three legal entities).

**ExtractionDraft, not parseResult.** The pre-AI ingestion path wrote `PlacementSlipUpload.parseResult` directly. The new pipeline writes a separate `ExtractionDraft` row keyed 1:1 to the upload. Status flow: `QUEUED` → `EXTRACTING` → `READY` → `APPLIED` (or `FAILED` / `DISCARDED`). `ExtractionDraft.extractedProducts` holds `ExtractedProduct[]` validated against `extracted-product.json`; the broker reviews and edits in the new `/imports/[uploadId]/review` UI; on Apply the existing `applyToCatalogue` mutation creates real `Product` / `Plan` / `PolicyEntity` / `PremiumRate` rows. Heuristic parsing stays as a deterministic prepass — same `parsingRules` per insurer — but the LLM owns the final shape.

**Two prisma migrate deploys per CI/CD run.** The deploy workflow runs `prisma migrate deploy` from the GitHub runner before swapping the image, AND the new container's `docker/entrypoint.sh` runs it again on startup. Both are idempotent, so this is fine — either path alone is enough. The runner path is faster feedback (you see the migration apply in the workflow log); the container path is the safety net for any deploy that bypasses the workflow.

**Resource naming for observability.** Log Analytics is `${appName}-law` (not `-logs`); Application Insights is `${appName}-ai` (not `-appi`). These match the resources bootstrapped via az CLI on 2026-04-30; the Bicep modules were renamed to adopt them as no-ops rather than create duplicates.

---

Update this file whenever a convention solidifies or a recurring confusion appears. It is the first thing a fresh Claude Code session reads, and it should reflect reality.
