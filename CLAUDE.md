# CLAUDE.md

Persistent context for Claude Code working in this repository. Read this first on every session before writing code.

## What this is

A multi-agency white-label SaaS platform for insurance brokerage agencies. Brokers ingest placement slips (Excel workbooks) from insurers, manage structured policy data via a metadata-driven product catalogue, and publish versioned configurations for employee consumption. The employee portal (Phase 2) is live in the same app at `/portal`. Replaces an older system called Inspro.

The single most important design idea: **the product catalogue is data, not code.** Every insurer product (GTL, GHS, GPA, and so on) is defined by a JSON Schema stored in the database. Product instances are JSONB validated against that schema on every write. Adding a new product never requires a code deploy. If you catch yourself writing product-specific `if` branches in application code, stop — extend the catalogue instead.

## Stack

Node.js 22 LTS, TypeScript strict. Next.js 15 with App Router as a single full-stack app. PostgreSQL 16 via Prisma 5. **Auth.js (NextAuth v5) with email/password credentials** for Phase 1 authentication — WorkOS AuthKit is the planned Phase 2 migration (schema reserves `User.workosUserId`). Ajv for JSON Schema validation, Zod for API input validation, `@rjsf/core` for auto-generating admin forms from catalogue schemas, `json-logic-js` for benefit group eligibility predicates, `exceljs` for placement slip parsing, BullMQ with Azure Redis for background jobs. Biome for linting and formatting. Vitest for unit and integration tests, Playwright for end-to-end. pnpm for package management.

Hosting: GitHub for source and CI, Azure Container Apps for runtime, Azure Database for PostgreSQL Flexible Server, Azure Cache for Redis, **SharePoint (via Microsoft Graph + ROPC delegated auth) for uploaded files** — same pattern as sister-project PAD; the lib lives at `apps/web/src/server/storage/sharepoint.ts`. Azure Key Vault for secrets, Application Insights (workspace-based, backed by Log Analytics) for observability. All resources in `southeastasia` region for Singapore PDPA data residency.

AI extraction layer (placement-slip → catalogue JSON) is **BYOK per tenant** — each tenant supplies their own Azure AI Foundry endpoint + deployment + key via the `/admin/settings/ai-provider` UI. The platform never holds a shared LLM key; instead it stores per-tenant credentials encrypted at rest with AES-256-GCM (`apps/web/src/server/security/secret-cipher.ts`, master key from `APP_SECRET_KEY` env). Plaintext keys never leave server memory and are never logged.

## Repo layout

```
apps/web/              Next.js app
  src/app/             App Router routes
    (auth)/            sign-in, callbacks
    admin/             broker admin surfaces, tenant-scoped
      settings/        tenant-level config (ai-provider, …)
    portal/            employee-facing portal (Phase 2)
                       dashboard, benefits, dependents, profile, documents
    api/               route handlers
  src/server/          server-only code
    auth/              session helpers (Auth.js for Phase 1)
    db/                Prisma client + tenant helpers
    catalogue/         ProductType logic, schema validation (Ajv singleton)
                       employee-field-schema.ts — shared JSON Schema prop builder
    ingestion/         Excel parser + AI extraction pipeline
    policies/          lifecycle, publish workflow
    portal/            employee-context.ts — resolves Employee from User.id
    security/          app-level encryption (secret-cipher.ts)
    storage/           SharePoint client (sharepoint.ts)
    jobs/              BullMQ workers
    tenant/            middleware + scoping helpers
    trpc/              router composition + role guards
  src/components/      React components
    ui/                centralised primitives (ScreenShell, Card, Field,
                       ConfidenceBadge, Form). New screens MUST consume
                       these instead of inventing layouts.
    portal/            employee portal components (benefit-card, dependents-screen,
                       profile-screen, dashboard-screen, portal-nav, …)
  src/lib/             shared client+server utilities
                       format-rate.ts — formatRate(rate) → string
                       dependent-labels.ts — RELATION_LABEL, ACTION_LABEL
  tests/               unit, integration, e2e
docker/                container entrypoint scripts
packages/catalogue-schemas/   seed JSON Schemas (GHS, GTL, …) + extracted-product.json
packages/shared-types/        shared TS types
prisma/                schema + migrations + seed
infra/bicep/           Azure IaC (modules: container-app, postgres, redis,
                       app-insights, log-analytics, container-registry, …)
                       *.bicep + *.json only — no docs/READMEs here.
                       CI's "Detect infra changes" step diffs `infra/`
                       and triggers a slow full-Bicep redeploy on any
                       change; doc edits inside infra/ are a footgun.
scripts/               dev bootstrap, codegen
```

## Commands

```
pnpm install                    install dependencies
./scripts/dev-setup.sh          bootstrap local environment (Docker Postgres + Redis, migrations, seed)
pnpm dev                        run app at localhost:3000
pnpm test                       run Vitest unit + integration
pnpm vitest run <file>          run a single test file (e.g. pnpm vitest run apps/web/src/server/catalogue/product-type.test.ts)
pnpm vitest run -t "<name>"     run tests matching a name pattern
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

**Data access.** Prisma for all database access. Never write raw SQL except in rare performance-driven cases, which must come with a comment explaining why.

**tRPC procedure types.** Four procedure tiers — do not pick the wrong one:
  - `publicProcedure`: no auth required (avoid; there are almost no legitimate uses in this app).
  - `tenantProcedure`: requires auth + valid tenant session; auto-injects `ctx.db` (tenant-scoped) and fires audit middleware on mutations (fire-and-forget).
  - `adminProcedure`: `tenantProcedure` + role gate; only `TENANT_ADMIN`, `BROKER_ADMIN`, or `CATALOGUE_ADMIN` may call it. Use for all broker-admin write operations.
  - `portalProcedure`: `tenantProcedure` + `EMPLOYEE`/`CLIENT_HR` role gate + employee resolution. Adds `ctx.employeeId` and `ctx.clientId`; every portal query is hard-scoped to the authenticated employee's own data. Never accept a caller-supplied `employeeId` on portal procedures.
  The router is composed in `apps/web/src/server/trpc/` — add new routers in `routers/` and register in `router.ts`.

**Tenant scoping.** Every tenant-scoped Prisma query goes through `requireTenantContext()` which returns a tenant-scoped client. A Prisma middleware rejects queries on tenant-scoped tables that lack a `tenantId` filter — bypass is not possible. Postgres row-level security policies enforce the same boundary at the database layer (defence-in-depth). If a query genuinely needs cross-tenant read (like platform-level admin dashboards), use `__requireServiceContext()` explicitly and log its use. **Inside routers always reach for `ctx.db` (the tenant-scoped extension), never the bare `prisma` client, when touching one of the 16 TENANT_MODELS** (User, EmployeeSchema, Insurer, TPA, Pool, ProductType, Client, AuditLog, TenantAiProvider, ExtractionDraft, BenefitGroupPreset, EndorsementCatalogue, ExclusionCatalogue, PlacementSlipUpload, DependentChangeRequest, EmployeeInvitation) — the bare client bypasses the auto-injected tenantId filter and is reserved for non-tenant-scoped models which gate via parent FK joins.

**Connection pooling — pooler mode matters.** RLS scope is set per connection via `SELECT set_config('app.current_tenant_id', …, false)` (session-level). The application connects through Azure Database for PostgreSQL with the bundled connection pooler (Supavisor / pgBouncer). **The pooler MUST run in `session` mode, not `transaction` mode** — in transaction mode the connection bound to a request can be released back to the pool and re-issued to the next request with the previous tenant's GUC still set, leaking RLS scope across tenants. The Bicep templates pin session mode; if you ever override the connection string by hand (or migrate to a different pooler), verify mode before pointing prod at it. Production should additionally connect as the non-superuser `app_user` role (created in migration `20260430120000_app_user_role_and_force_rls`) so RLS policies actually apply — superusers bypass RLS regardless of mode.

**API routes.** Every server action and route handler:
  1. Resolves the tenant context from the session (via `requireTenantContext()`).
  2. Validates input with Zod (define the schema alongside the handler).
  3. Returns typed results; errors as discriminated unions, not thrown exceptions, unless the caller has to crash (validation errors don't; programming errors do).

**Validation layers.** Three distinct validators, do not conflate:
  - Zod validates API input (the shape of what a user submitted).
  - Ajv validates catalogue JSONB against `ProductType.schema` and `ProductType.planSchema` (the insurance-domain rules).
  - Ajv also validates AI-extracted JSON against `packages/catalogue-schemas/extracted-product.json` (the LLM output contract — every leaf must be `{value, raw, confidence, sourceRef}`).

**Secrets at rest.** Tenant-supplied secrets (Azure AI Foundry keys today; future BYOK creds) are encrypted with AES-256-GCM via `apps/web/src/server/security/secret-cipher.ts`. The master key comes from `APP_SECRET_KEY` (Container App secret in prod, `.env.local` in dev — set with `openssl rand -base64 48`). The cipher format is `v1.<base64url(iv ‖ ciphertext ‖ authTag)>` so we can rotate later without breaking old rows. Never log plaintext keys, never persist them outside the encrypted column, and never echo them back from a tRPC procedure — `getMasked` returns `keyLastFour` only.

**Forms.** Admin forms are generated from catalogue JSON Schemas via `@rjsf/core` for product-specific data. Hand-written forms are only for metadata (Client name + UEN, User profile, Insurer label, AI provider config) — and those use the `<Form>` + `<Field>` primitives in `apps/web/src/components/ui/` (react-hook-form + Zod under the hood). Portal forms that are schema-driven from `EmployeeField[]` at runtime use `useState`-driven `formValues` with `<Field>` for layout — the only permitted exception to no-useState-forms, because the field list isn't known at compile time. Do not invent new patterns beyond these three.

**UI primitives.** Every new admin screen consumes the `components/ui/` layer: `<ScreenShell>` for compact page header (title + optional one-line context + right-docked actions; no descriptive paragraph slot — the rail tells users where they are), `<Card>` for surfaces, `<Field>` for labelled inputs, `<ConfidenceBadge>` for AI-extraction confidence chips, `<Form>` for hand-written forms. Spacing comes from utility classes (`gap-*`, `mb-*`, `p-*`, `flex`, `items-center`, `justify-between`) mapped to `--space-*` tokens — do not reach for inline `style={{}}`. There is no app-wide breadcrumb — pages that need a back link use a contextual `<Link>` inside the page (e.g. a `Cancel` button on edit forms).

**Navigation.** Top nav has three sections — **Clients**, **Catalogue**, **Settings** — rendered by `<TopNav>` in `apps/web/src/components/admin/top-nav.tsx`. A persistent left rail (`<SectionRail>` in `apps/web/src/components/admin/section-rail.tsx`) auto-renders the sub-page list for the current section: Catalogue rail lists Employee Schema / Product Types / Insurers / TPAs / Pools; Settings rail lists AI Provider; Clients rail shows "All clients" on the list page and switches to per-client sub-pages (Policies / Imports / Employees / Claims / Edit details) with the client name as a heading on detail pages. To add a new sub-page, register it in the relevant nav array — do not invent per-page nav widgets.

**Error handling.** Server-side errors log with structured context (tenant id, user id, request id, action). Client-side error boundaries present a friendly message and a reference id. Never expose raw error messages to end users.

**Tests.** Every server module has unit tests. Every server action has at least one integration test hitting a real Postgres (via testcontainers or a dedicated test DB). Every critical admin workflow has at least one Playwright test. Tests live next to their source (`foo.ts` next to `foo.test.ts`) for unit, under `tests/integration` and `tests/e2e` for the others.

**Migrations.** One migration per logical change. Migration names are descriptive (`add_product_type_version_immutability_trigger`, not `update_schema`). Destructive migrations in production require a separate data migration + application deploy pair. Every new tenant-scoped table MUST also include its RLS policy in the same migration — see `20260428100000_extend_rls/migration.sql` for the canonical pattern. The container's `docker/entrypoint.sh` runs `prisma migrate deploy` before `next start` on every revision boot, so a pushed migration auto-applies on the next deploy and a broken migration fails-fast (Container Apps rolls back the bad revision automatically).

**Commits.** Conventional Commits, pushed directly to `main`. Small, focused, one concern per commit. The first line is the changelog entry; only use a body when the *why* needs more space. Run the full local check suite (`pnpm typecheck && pnpm check && pnpm test && pnpm build`) before every push — there is no PR review gate.

## Architecture principles

**The catalogue is data.** If you need to special-case a product in application code, the special case belongs in the catalogue — extend the JSON Schema, update the ingestion template, update the display template, or pick a different `premiumStrategy`. Application code stays product-agnostic.

**Tenant isolation is absolute.** Every query filters by `tenantId`. Every JSONB field is tenant-scoped. Postgres RLS is the second line of defence. No exceptions without explicit human sign-off.

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
- Set a placeholder / single-character value in any GitHub Actions repo secret listed at the top of `.github/workflows/ci.yml`. Bicep faithfully writes whatever you pass into the live Container App secret bag, overwriting whatever was there. A 1-char `AUTH_SECRET` once silently crash-looped staging on the next infra-triggered redeploy. The deploy workflow now has a `Verify deploy secrets before Bicep` guard step that fails the run with a `::error::` line if any secret is below its minimum length — never `--no-verify` past it; fix the GitHub secret with `gh secret set <NAME>` instead.
- Add docs / READMEs / markdown inside `infra/`. The detect-infra-changes filter is now `infra/**/*.{bicep,json}` only; reverting that filter or adding non-deployment files inside `infra/` re-opens the footgun where a doc edit triggered a full ARM redeploy AND clobbered live secrets.
- Render decorative eyebrows (`<p className="eyebrow">Onboarding · Screen 1</p>`, `<p className="eyebrow">{client.legalName}</p>`) at the top of admin screens — the section rail tells users where they are and the screen-shell head shows what page they're on. For per-page context (e.g. benefit year state, version), use the `context` slot on `<ScreenShell>`.
- Render long descriptive paragraphs above the page header explaining what an entity is ("Each client is a legal entity..."). Admins are power users; the labels speak for themselves. Reserve prose for inline `field-help` next to specific inputs only.
- Catch-and-ignore errors. Either handle them meaningfully or let them propagate with context.
- Modify migrations that have been applied to any environment beyond local dev. Create a new migration instead.
- Use raw SQL without a comment justifying it.
- Add a library without considering maintenance overhead. Check: is it actively maintained, well-typed, secure, and does Biome lint its outputs?
- Copy-paste placement slip values between product instances. Use the seed script or the UI. Copy-pasted data skips validation.

## Common tasks

**Adding a new product type to the catalogue.** Do it through the catalogue admin UI, not through code. The seed script is only for dev bootstrap. If you must add via code (migration, for example), create a Prisma seed script that calls the same server action the admin UI uses — never bypass the validation path.

**Changing an existing product type's schema.** Publish a new version. Do not mutate the existing version. Old instances continue to reference the old version. Write a migration function if instances need to upgrade.

**Adding a new field to a relational core table.** Prisma migration, update dependent TypeScript types, update seed if needed, update tests.

**Adding a new admin route.** Create under `apps/web/src/app/admin/`. Add to the side nav if user-facing. The middleware and layout protect the whole `/admin` prefix — do not re-implement auth per route.

**Adding a new portal route.** Create under `apps/web/src/app/portal/`. Register the nav link in `src/components/portal/portal-nav.tsx`. Use `portalProcedure` for all data access — never accept a caller-supplied employee ID. The portal layout at `src/app/portal/layout.tsx` handles the shell and nav.

**Adding a new background job.** Define in `apps/web/src/server/jobs/`. Register the worker. Queue from server actions via a typed helper. Every job has retry policy and dead-letter behaviour.

**Reading placement slip data.** Use the existing parser service in `apps/web/src/server/ingestion/`. Parser driven by ingestion templates from the catalogue. Do not write product-specific parser code.

**Testing code that uses the database.** Spin up a Postgres via testcontainers in the test setup. Wrap each test in a transaction that rolls back on teardown.

**Working with Azure resources.** Everything goes through Bicep. Do not create resources via portal or CLI without capturing them in Bicep after. The deploy workflow (`.github/workflows/ci.yml`) takes the **fast path** (image-only update) when no `*.bicep` or `*.json` file under `infra/` has changed, and the **full Bicep path** when one has — be deliberate about which one you're triggering. Required GitHub Actions secrets are listed at the top of `ci.yml`; the `Verify deploy secrets before Bicep` step rejects the run before any infra is touched if a secret is missing or below its required length (AUTH_SECRET / APP_SECRET_KEY ≥32, POSTGRES_ADMIN_PASSWORD ≥16, SharePoint IDs ≥30, etc.). When a secret IS missing or wrong, fix it with `gh secret set <NAME>` BEFORE re-pushing — and once a real value is in the GitHub secret, the next full-Bicep deploy will write it back into the Container App secret bag.

**Adding a tenant-supplied secret.** New BYOK feature? Add it to the `TenantAiProvider` model only if it shares the AI Foundry shape; otherwise model a sibling `Tenant<X>Credential` table with `encryptedKey: String` + `keyLastFour: String @db.VarChar(4)` columns and the same RLS policy. Always go through `encryptSecret()` / `decryptSecret()` — never store plaintext. Expose a `getMasked` query that returns `keyLastFour` only, an `upsert`/`clear` mutation pair on `adminProcedure`, and a `test` mutation that decrypts in-memory and exercises the live API. The `apps/web/src/server/trpc/routers/tenant-ai-provider.ts` router is the canonical template.

## When stuck

If the question is architectural and this file doesn't answer it, ask the human. If it's tactical (a library quirk, a type error), search the codebase for similar patterns, then search the web, then ask.

Never silently invent behaviour. If a requirement is ambiguous, ask. If you made an assumption to keep moving, leave a `// TODO(assumption):` comment and flag it in the commit body.

## Things that will probably confuse you

### Data model

**Tenant and User mapping.** Phase 1 auth is Auth.js credentials (email + bcrypt password). The `Tenant` is our multi-tenancy boundary — every tenant-scoped table carries a `tenantId`. `User.workosUserId` is a nullable reserved column for the Phase 2 WorkOS migration; it is unused today. A User belongs to exactly one Tenant.

**Two JSON Schemas per product type, plus a strategy code.** `ProductType.schema` covers the product-instance fields; `ProductType.planSchema` covers plan rows (including `stacksOn` and `selectionMode`). `ProductType.premiumStrategy` is a string code (e.g. `per_group_cover_tier`) that picks one of the strategy modules under `apps/web/src/server/premium-strategies/` — premium math is code, not catalogue data.

**Ingestion template versus display template.** Ingestion (`ProductType.parsingRules`) is how to parse Excel *into* the catalogue shape. Display (`ProductType.displayTemplate`) is how to render the shape *to* users (minimal in Phase 1; primary surface for Phase 2). Both live on the `ProductType` row alongside the schemas.

**Benefit groups use JSONLogic, not a custom DSL.** `BenefitGroup.predicate` is a JSONLogic JSON expression. Evaluator is `json-logic-js`. Do not invent a DSL — keep in step with a standard format that has implementations in every language we might need downstream.

**EmployeeSchema is a single JSON array per tenant, not a table of rows.** `EmployeeSchema.fields` is one JSONB column holding all field definitions. Fields are discriminated by `field.tier`:
  - `BUILT_IN` — immutable core fields (e.g. `full_name`, `date_of_birth`). Never delete or rename.
  - `STANDARD` — pre-defined optional fields brokers can toggle on/off.
  - `CUSTOM` — tenant-defined fields with full CRUD.
  Every save bumps a version counter. Downstream consumers (Ajv schema compilation, Excel parser, predicate evaluator) cache by `tenantId:version` — bumping version is the only correct cache-invalidation mechanism. Do not bypass the version counter by patching `fields` directly.

**Cover tiers.** The four values are `EO` (employee only), `ES` (employee + spouse), `EC` (employee + child), `EF` (employee + family). `deriveCoverTier(dependents)` computes the tier from an employee's dependent list. Some products only support `EO`/`EF` — call `collapseTier(tier, supported)` to map `ES`/`EC` → `EF` for those products. Premium rate lookup keys are `${planId}:${coverTier}` with a `${planId}:*` wildcard fallback for flat-rate plans.

**Six metadata registries drive every dropdown.** Global Reference (Country/Currency/Industry), Insurer Registry, TPA Registry, Pool Registry, Product Catalogue, Operator Library, and the per-tenant Employee Schema. None of these dropdowns are hardcoded in UI code. See v2 plan §1.2 and §3 for sources of truth.

**Policy, BenefitYear, Product, Plan — four different things.** A `Policy` is the abstract policy. A `BenefitYear` is a specific draft or published configuration for a benefit year (`DRAFT` / `PUBLISHED` / `ARCHIVED`). A `Product` is an instance of a `ProductType` under that `BenefitYear`. A `Plan` is one option within a Product (and may stack on another via `stacksOn`). The hierarchy is Tenant > Client > Policy > BenefitYear > Product > {Plans, PremiumRates, ProductEligibility}, with `PolicyEntity` rows sitting under Policy for multi-entity master policies (e.g. STM's three legal entities).

For extraction pipeline internals, Create Client wizard, and benefit group / predicate details see **[docs/EXTRACTION.md](docs/EXTRACTION.md)**.

### Employee portal

**`Employee.userId` is how the portal authenticates an employee.** An `Employee` row has a nullable `userId` FK. Until that FK is set, the employee cannot log into the portal — `requireEmployeeFromUser()` in `server/portal/employee-context.ts` throws FORBIDDEN if the session user has no linked Employee row. Setting `Employee.userId` is what "activates" a portal account. The invitation flow (EmployeeInvitation model) is reserved for future welcome-email setup and is not wired to any UI yet.

**DependentChangeRequest approval is a four-step atomic transaction.** When a broker approves a request, the server: (1) applies the ADD/EDIT/REMOVE to the `Dependent` table, (2) refetches all dependents for that employee, (3) calls `deriveCoverTier()` to compute the new tier, then (4) parallelises `enrollment.updateMany` (new cover tier) and `dependentChangeRequest.update` (status=APPROVED) inside a single `prisma.$transaction`. If the transaction fails, neither the Dependent row nor the request status changes. Rejection only stamps the request status — no dependent mutation.

**Portal forms use `<Field>` but not `<Form>`.** Admin metadata forms use the full `<Form>` + `<Field>` stack (react-hook-form + Zod). Portal profile editing is schema-driven from `EmployeeField[]` and uses `useState`-driven `formValues` instead — that's the one intentional exception to the "no useState-driven forms" rule, because the fields are dynamic and the Zod schema can't be statically typed. Still uses `<Field>` for label+input layout; still validates through Ajv server-side on `profile.update`.

**`employeeEditable` is a flag on individual fields, not on the schema.** In `EmployeeSchema.fields`, each field has an optional `employeeEditable?: boolean`. Only fields with this flag set are shown in the edit form on the portal profile page; the rest are read-only. The `profile.update` mutation enforces the same set server-side — it silently drops any submitted key not in `editableNames` before running Ajv.

### Deployment & infra

**Two prisma migrate deploys per CI/CD run.** The deploy workflow runs `prisma migrate deploy` from the GitHub runner before swapping the image, AND the new container's `docker/entrypoint.sh` runs it again on startup. Both are idempotent, so this is fine — either path alone is enough. The runner path is faster feedback (you see the migration apply in the workflow log); the container path is the safety net for any deploy that bypasses the workflow.

**Resource naming for observability.** Log Analytics is `${appName}-law` (not `-logs`); Application Insights is `${appName}-ai` (not `-appi`). These match the resources bootstrapped via az CLI on 2026-04-30; the Bicep modules were renamed to adopt them as no-ops rather than create duplicates.

### UI & shared utilities

**Shared front-end utilities — use these, don't re-implement.** `src/lib/format-date.ts` exports `formatDate(d: Date | string | null | undefined): string` (ISO date or "—"). `src/lib/employee-display.ts` exports `employeeDisplayLabel(data)` (reads `employee.full_name`, falls back to first non-empty string field, then "(no name)"). `src/lib/cover-tier.ts` exports `deriveCoverTier(dependents)` and `collapseTier(tier, supported)`. `src/lib/employee-import.ts` exports `UPLOAD_TEMPLATE_COLUMNS`, `PLAN_OVERRIDE_COLUMNS`, and transform helpers for the broker CSV template. `src/lib/format-rate.ts` exports `formatRate(rate: RateShape): string` — renders premium rates as either "X.XXXX per $1,000 SI" or "X.XX / yr"; use for any rate display in admin and portal. `src/lib/dependent-labels.ts` exports `RELATION_LABEL` and `ACTION_LABEL` record maps for dependent change request display.

**Employee detail page has Profile + Entitlements + Change Requests tabs.** `/admin/clients/[id]/employees/[employeeId]` renders `EmployeeDetailScreen` which eagerly fetches `employees.byId`, `employees.entitlements`, and `employees.changeRequests.listByEmployee`. The entitlements query returns enriched enrollment rows (product type, plan, benefit group, cover tier, matching premium rate). Rate lookup uses a Map keyed by `planId:coverTier` with a `planId:*` wildcard fallback for null-coverTier rates. The Change Requests tab shows pending `DependentChangeRequest` rows — brokers approve or reject inline; approval atomically applies the dependent mutation and recalculates the cover tier via `prisma.$transaction`.

---

Update this file whenever a convention solidifies or a recurring confusion appears. It is the first thing a fresh Claude Code session reads, and it should reflect reality.
