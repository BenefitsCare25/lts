# CLAUDE.md

Persistent context for Claude Code working in this repository. Read this first on every session before writing code.

## What this is

A multi-agency white-label SaaS platform for insurance brokerage agencies. Brokers ingest placement slips (Excel workbooks) from insurers, manage structured policy data via a metadata-driven product catalogue, and publish versioned configurations ready for employee-facing consumption (employee portal is Phase 2, not in this repo yet). Replaces an older system called Inspro.

The single most important design idea: **the product catalogue is data, not code.** Every insurer product (GTL, GHS, GPA, and so on) is defined by a JSON Schema stored in the database. Product instances are JSONB validated against that schema on every write. Adding a new product never requires a code deploy. If you catch yourself writing product-specific `if` branches in application code, stop — extend the catalogue instead.

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
    ui/                centralised primitives (ScreenShell, Card, Field,
                       ConfidenceBadge, Form). New screens MUST consume
                       these instead of inventing layouts.
  src/lib/             shared client+server utilities
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

**Tenant scoping.** Every tenant-scoped Prisma query goes through `requireTenantContext()` which returns a tenant-scoped client. A Prisma middleware rejects queries on tenant-scoped tables that lack a `tenantId` filter — bypass is not possible. Postgres row-level security policies enforce the same boundary at the database layer (defence-in-depth). If a query genuinely needs cross-tenant read (like platform-level admin dashboards), use `__requireServiceContext()` explicitly and log its use. **Inside routers always reach for `ctx.db` (the tenant-scoped extension), never the bare `prisma` client, when touching one of the 14 TENANT_MODELS** (User, EmployeeSchema, Insurer, TPA, Pool, ProductType, Client, AuditLog, TenantAiProvider, ExtractionDraft, BenefitGroupPreset, EndorsementCatalogue, ExclusionCatalogue, PlacementSlipUpload) — the bare client bypasses the auto-injected tenantId filter and is reserved for non-tenant-scoped models which gate via parent FK joins.

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

**Forms.** Admin forms are generated from catalogue JSON Schemas via `@rjsf/core` for product-specific data. Hand-written forms are only for metadata (Client name + UEN, User profile, Insurer label, AI provider config) — and those use the `<Form>` + `<Field>` primitives in `apps/web/src/components/ui/` (react-hook-form + Zod under the hood). Do not invent a third form pattern; do not roll `useState`-driven forms in new code.

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

**Adding a new route.** Create under `apps/web/src/app/(admin)/`. Add to the side nav if user-facing. Protect via the existing `(admin)` layout — do not re-implement auth per route.

**Adding a new background job.** Define in `apps/web/src/server/jobs/`. Register the worker. Queue from server actions via a typed helper. Every job has retry policy and dead-letter behaviour.

**Reading placement slip data.** Use the existing parser service in `apps/web/src/server/ingestion/`. Parser driven by ingestion templates from the catalogue. Do not write product-specific parser code.

**Testing code that uses the database.** Spin up a Postgres via testcontainers in the test setup. Wrap each test in a transaction that rolls back on teardown.

**Working with Azure resources.** Everything goes through Bicep. Do not create resources via portal or CLI without capturing them in Bicep after. The deploy workflow (`.github/workflows/ci.yml`) takes the **fast path** (image-only update) when no `*.bicep` or `*.json` file under `infra/` has changed, and the **full Bicep path** when one has — be deliberate about which one you're triggering. Required GitHub Actions secrets are listed at the top of `ci.yml`; the `Verify deploy secrets before Bicep` step rejects the run before any infra is touched if a secret is missing or below its required length (AUTH_SECRET / APP_SECRET_KEY ≥32, POSTGRES_ADMIN_PASSWORD ≥16, SharePoint IDs ≥30, etc.). When a secret IS missing or wrong, fix it with `gh secret set <NAME>` BEFORE re-pushing — and once a real value is in the GitHub secret, the next full-Bicep deploy will write it back into the Container App secret bag.

**Adding a tenant-supplied secret.** New BYOK feature? Add it to the `TenantAiProvider` model only if it shares the AI Foundry shape; otherwise model a sibling `Tenant<X>Credential` table with `encryptedKey: String` + `keyLastFour: String @db.VarChar(4)` columns and the same RLS policy. Always go through `encryptSecret()` / `decryptSecret()` — never store plaintext. Expose a `getMasked` query that returns `keyLastFour` only, an `upsert`/`clear` mutation pair on `adminProcedure`, and a `test` mutation that decrypts in-memory and exercises the live API. The `apps/web/src/server/trpc/routers/tenant-ai-provider.ts` router is the canonical template.

## When stuck

If the question is architectural and this file doesn't answer it, ask the human. If it's tactical (a library quirk, a type error), search the codebase for similar patterns, then search the web, then ask.

Never silently invent behaviour. If a requirement is ambiguous, ask. If you made an assumption to keep moving, leave a `// TODO(assumption):` comment and flag it in the commit body.

## Things that will probably confuse you

**WorkOS Organizations.** A WorkOS Organization is our `Tenant`. A WorkOS User is our `User`, linked to exactly one Tenant. Do not assume a User can belong to multiple Tenants — Phase 1 says one per user. The Tenant model stores no WorkOS column directly — the mapping is by `slug` to organization metadata, and `User.workosUserId` carries the WorkOS user identifier.

**Two JSON Schemas per product type, plus a strategy code.** `ProductType.schema` covers the product-instance fields; `ProductType.planSchema` covers plan rows (including `stacksOn` and `selectionMode`). `ProductType.premiumStrategy` is a string code (e.g. `per_group_cover_tier`) that picks one of the strategy modules under `apps/web/src/server/premium-strategies/` — premium math is code, not catalogue data.

**Ingestion template versus display template.** Ingestion (`ProductType.parsingRules`) is how to parse Excel *into* the catalogue shape. Display (`ProductType.displayTemplate`) is how to render the shape *to* users (minimal in Phase 1; primary surface for Phase 2). Both live on the `ProductType` row alongside the schemas.

**Benefit groups use JSONLogic, not a custom DSL.** `BenefitGroup.predicate` is a JSONLogic JSON expression. Evaluator is `json-logic-js`. Do not invent a DSL — keep in step with a standard format that has implementations in every language we might need downstream.

**Six metadata registries drive every dropdown.** Global Reference (Country/Currency/Industry), Insurer Registry, TPA Registry, Pool Registry, Product Catalogue, Operator Library, and the per-tenant Employee Schema. None of these dropdowns are hardcoded in UI code. See v2 plan §1.2 and §3 for sources of truth.

**Policy, BenefitYear, Product, Plan — four different things.** A `Policy` is the abstract policy. A `BenefitYear` is a specific draft or published configuration for a benefit year (`DRAFT` / `PUBLISHED` / `ARCHIVED`). A `Product` is an instance of a `ProductType` under that `BenefitYear`. A `Plan` is one option within a Product (and may stack on another via `stacksOn`). The hierarchy is Tenant > Client > Policy > BenefitYear > Product > {Plans, PremiumRates, ProductEligibility}, with `PolicyEntity` rows sitting under Policy for multi-entity master policies (e.g. STM's three legal entities).

**ExtractionDraft, not parseResult.** The pre-AI ingestion path wrote `PlacementSlipUpload.parseResult` directly. The new pipeline writes a separate `ExtractionDraft` row keyed 1:1 to the upload. Status flow: `QUEUED` → `EXTRACTING` → `READY` → `APPLIED` (or `FAILED` / `DISCARDED`). `ExtractionDraft.extractedProducts` holds `ExtractedProduct[]` validated against `extracted-product.json`; the broker reviews and edits in the new `/imports/[uploadId]/review` UI; on Apply the existing `applyToCatalogue` mutation creates real `Product` / `Plan` / `PolicyEntity` / `PremiumRate` rows. Heuristic parsing stays as a deterministic prepass — same `parsingRules` per insurer — but the LLM owns the final shape.

**Two upload paths.** `PlacementSlipUpload` supports two lifecycles: **bound** uploads (`upload` mutation, clientId is set at upload time, used by the existing `/admin/clients/[id]/imports` flow) and **orphan** uploads (`uploadOrphan` mutation, clientId is null, used by the import-first Create Client wizard at `/admin/clients/new/import/[uploadId]`). The orphan path persists bytes under a tenant-only SharePoint folder; the wizard's Apply step (`extractionDrafts.applyToCatalogue`) creates the Client + Policy + BenefitYear + PolicyEntities in a single Prisma transaction and back-fills `clientId` on the upload. Direct `tenantId` column was added to `PlacementSlipUpload` in migration `20260430140000_wizard_foundation` so RLS works for orphan rows (parent-FK helpers return null when clientId is missing).

**Wizard sections read from one place.** The Create Client wizard has **9 sections** (source → client → entities → benefit_year → insurers → products → schema_additions → reconciliation → review). All read `ExtractionDraft.extractedProducts` (envelope-shaped per `extracted-product.json`) and `ExtractionDraft.progress.suggestions` (predicates, eligibility matrix, missing fields, reconciliation produced by `server/extraction/extractor.ts`). Adding a new section = registering it in `_components/sections/_registry.ts` and `section-components.tsx`; the shell never branches on section id.

**Benefit groups live inside the Products section, not as a separate nav step.** The `eligibility` SectionId was removed from the registry. Benefit group management is now the **Groups tab** inside the Products section — it is scoped to the currently active product (switch the product pill to configure each product's plan assignments separately). Broker overrides are still stored under `brokerOverrides.eligibility.groups` in `ExtractionDraft.progress` — the namespace key `'eligibility'` was not renamed, only the UI surface moved. The Products section has **4 tabs: Details | Plans & rates | Groups | Endorsements**. Plans and rates are unified in a single `plans-rates-tab.tsx` — each plan card shows its rates inline and has a collapsible benefit-group preview. `eligibility.tsx` is kept as dead code (it is no longer registered in `section-components.tsx`).

**Groups tab defaults all categories to `included: true`.** On fresh init (no persisted broker overrides), every derived category is initialised with `{ included: true }` regardless of `tokenMatches`. The `GroupCard` fallback prop also defaults to `{ included: true }` when `override.groups[c.key]` is absent. Groups with no matching predicate tokens show an empty `{}` predicate and remain visible — the broker edits the predicate manually or removes the group. Do NOT gate `included` on `tokenMatches > 0`; that would hide valid groups just because the AI couldn't infer a predicate expression.

**TPA is per-product, not global.** `WizardExtractedProduct` carries `tpaId: string | null` (a plain string, not an AI envelope — broker-selected only). The TPA dropdown is in the **Details tab** of each product. The old global TPA card in the Insurers section has been removed, and the `'tpa'` broker-override namespace has been deleted. `normalizeProduct()` in `_types.ts` defaults `tpaId` to `null` so old drafts that lack the field upgrade cleanly. The Apply path reads `tpaId` from the extracted product when creating `Product` rows.

**`normalizeProduct()` must guard every field added after v1.** When adding a new optional field to `WizardExtractedProduct` (header fields, nested array fields, top-level fields), add a `?? default` fallback in `normalizeProduct()` in `_types.ts` so old drafts that predate the field upgrade cleanly without null-dereference. Current guards: `tpaId` → `null`; all header age-limit envelopes → `EMPTY_NUMBER_FIELD` / `EMPTY_STRING_FIELD`; `eligibility.categories[].multiplier` → `null`. Pattern: cast the raw value to `(T | undefined)` and apply `?? fallback`. Forgetting this guard makes the wizard crash on any draft extracted before the field was added.

**Age limit fields in the Details tab are conditional by product type.** `details-tab.tsx` defines a relevance map (`AGE_LIMIT_RELEVANCE`) keyed by `productTypeCode`. Fields outside the relevant set are hidden unless they already have a non-null extracted value (edge-case guard). WICI shows no age limit fields; GTL/GPA/GBT show only employee/above-last-entry fields; GHS/GMM/SP show all six. Unknown product types fall back to showing all fields. The "Age limits" heading is hidden when no fields are relevant.

**Cover-tier rate rows (EO/ES/EC/EF) must be extracted as separate rate rows.** The AI prompt (`apps/web/src/server/extraction/ai/prompt-product.ts`) has an explicit "Cover-tier rate tables" section: set `coverTier` to "EO", "ES", "EC", or "EF" on each rate row; omit rows where the rate is 0 or blank; do NOT treat the Basis of Cover table's EO/EF headcount columns as rates — only the Rate/Premium section columns are rates. For medical products (GHS, GMM) without separate ES/EC tiers, extract only EO and EF rows.

**Two prisma migrate deploys per CI/CD run.** The deploy workflow runs `prisma migrate deploy` from the GitHub runner before swapping the image, AND the new container's `docker/entrypoint.sh` runs it again on startup. Both are idempotent, so this is fine — either path alone is enough. The runner path is faster feedback (you see the migration apply in the workflow log); the container path is the safety net for any deploy that bypasses the workflow.

**Resource naming for observability.** Log Analytics is `${appName}-law` (not `-logs`); Application Insights is `${appName}-ai` (not `-appi`). These match the resources bootstrapped via az CLI on 2026-04-30; the Bicep modules were renamed to adopt them as no-ops rather than create duplicates.

**Products without explicit plan codes (GTL, GPA-style).** Some products' Basis of Cover tables list employee categories (e.g. "Board of Directors", "All Others") with SI formulas per category, but have no "Plan" column with letter/number codes. For these, the AI extraction emits exactly **one synthetic plan** — `rawCode: "1"`, `rawName: "Default"` — and every `eligibility.categories` row sets `defaultPlanRawCode: "1"`. Premium rates are keyed to `planRawCode: "1"` and vary by category. Products WITH an explicit Plan column (GHS, GMM, GP, SP) extract each plan code (A, A1, B, B1, B2…) separately; their categories map to plans via `defaultPlanRawCode`. This distinction is enforced via prompt guidance in `apps/web/src/server/extraction/ai/prompt-product.ts` — if you see a product where plan names look like employee job titles, the extraction prompt's "How to tell the difference" section is the first place to check.

**Per-category salary multiples (GTL-style SI formulas).** When a GTL / GPA-style product has categories with DIFFERENT salary multiples (e.g. "Board of Directors: 36× LDBMS", "All Others: 24× LDBMS"), the AI extracts `multiplier` as a number on each `eligibility.categories` row and sets `schedule.multiplier = null` on the synthetic plan (no single plan-level multiple applies). The `multiplier` field is defined in `packages/catalogue-schemas/extracted-product.json` → `CategoryField` and in `WizardExtractedProduct.eligibility.categories` in `_types.ts`. The Plans & rates tab (`plans-rates-tab.tsx`) shows a Multiplier column when `plan.coverBasis === 'salary_multiple'`, cross-referencing each rate row's `blockLabel` against the category list via `categoryMultiplier()`. `normalizeProduct()` guards `multiplier ?? null` on every category so old drafts without the field don't crash.

**Duplicate plan extraction (known footgun).** Placement slips have two sources of plan data: a summary overview sheet (e.g. "GE_LIFE", "ZURICH") that lists category descriptions per product, and individual product sheets (e.g. "GEL-GTL", "GEL-GHS") that list the actual plan codes. The heuristic parser produces "ghost" plans from both sources — e.g. GTL ends up with 8 plans (4 long-form from "GE_LIFE" + 4 short-code from "GEL-GTL") instead of 4. The fix is `sanitisePlanRawCodes` in `apps/web/src/server/extraction/ai/runner.ts`, which runs on the merged result after `mergeProducts` to dedup by canonical short code. Phase 1 resolves "Plan A: …" → "A" via regex, and multi-line rawCodes → first line. Phase 2 resolves any remaining long codes via category label matching (prefix match ≥10 chars against `eligibility.categories[].defaultPlanRawCode`). Ghost plans with lower confidence are dropped; the product-sheet plan (higher confidence, has `schedule` fields) wins. Premium rates are remapped to the winning canonical code at the same time. If you re-see this symptom, the likely cause is a new slip whose summary sheet uses a naming pattern Phase 1 doesn't catch — add the pattern to `sanitisePlanRawCodes`.

**Benefit group → product plan matching uses a 5-pass resolver.** The eligibility matrix in `server/extraction/extractor.ts` (`buildEligibilityMatrix`) maps each benefit group to a default plan per product using five passes in order: (1) exact label match, (2) prefix match ≥15 chars for label-length variants across products, (3) grade-range containment — e.g. "Grade 18+" is fully contained in "Grade 16+" so it gets the same plan, (4) best grade overlap — "Grade 08-17" overlaps most with "Grade 08-15" so it picks that plan, (5) employment-type keyword fallback — "Bargainable Employees" matches any category label also containing "bargainable". This handles the common case where different products describe the same employee population with different grade cutoffs (e.g. GHS uses "Grade 18+" while GTL uses "Grade 16+"). Grade ranges are parsed by `parseGradeRange()` which understands "X and above", "X to Y", and foreign-worker variants (Work Permit / S-Pass). If benefit groups still show "not assigned" after extraction, check whether the category labels use a grade pattern the parser doesn't recognise — add it to `parseGradeRange` in `extractor.ts`.

**Foreign-worker grade groups and products with no FW categories.** When `buildEligibilityMatrix` runs grade-range matching (passes 3 and 4), it checks whether the product has any FW-specific category labels. If it has none (e.g. GTL only lists "Grade 16+" not "Grade 16+ WP/SP"), the FW flag on the benefit group's grade is ignored for that product — otherwise FW groups would never match and would always show "not assigned". The fix is in `extractor.ts`: `hasFwCategories` is computed per product and `effectiveGroupGrade.isForeignWorker` is overridden to `false` when the product has no FW categories. If you see FW groups stuck as "not assigned" for a specific product, check whether its category list contains any Work Permit / S-Pass labels.

**Benefit group predicate combining logic.** `inferPredicateFromText` in `predicate-patterns.ts` now uses three-way combining rather than always AND-ing: (a) two or more employment-type patterns → OR them (e.g. Bargainable + Intern/Contract are additive populations); (b) one employment-type pattern + a grade pattern and the label does NOT contain "who are" → OR them (grade 08–15 employees and bargainable staff are two additive groups sharing the same plan, not an intersection); (c) all other combinations → AND (e.g. Bargainable + firefighter = a subset). The `NON_BARGAINABLE` pattern sits before `BARGAINABLE` in `PREDICATE_PATTERNS` and the `BARGAINABLE` regex uses a negative lookbehind to avoid matching "Non-bargainable". If a new label produces a wrong predicate, check whether it falls into the wrong combining branch before adding new patterns.

**Near-duplicate benefit group labels are merged before display.** `predicate-suggester.ts` runs a Phase 2b prefix-dedup after grade-key merging: if two non-grade labels share a common prefix of ≥40 characters (case-insensitive), the longer label is merged into the shorter one. This collapses annotated variants like "Bargainable Employees, Interns & Contract Employees, including SGUnited Trainees (* Bargainable...)" into the base "Bargainable Employees, Interns & Contract Employees, including SGUnited Trainees" label. If a placement slip produces unexpected group merges, check whether two labels share a 40+ char prefix unintentionally.

**sourceRef.sheet uses the workbook sheet name, not the insurer template key.** `heuristic-to-envelope.ts` assigns `sourceRef.sheet` from `p.ratesSheet ?? p.templateInsurerCode`. `ratesSheet` is populated from `parsingRules.rates_block.sheet` (the actual Excel sheet name, e.g. "GEL-GTL") in `parser.ts`. `templateInsurerCode` is the catalogue lookup key (e.g. "GE_LIFE") — it only appears in sourceRef as a last-resort fallback when `ratesSheet` is absent. If rate citations show catalogue keys instead of sheet names, check that the parsing template has a `rates_block.sheet` field.

**Ghost rate guard — rates with ratePerThousand > 10 000 are dropped silently.** WICI and similar placement slips store annual earnings (~200M) as a raw cell value in the rates column; the heuristic parser emits these as astronomical `ratePerThousand` values. `heuristic-to-envelope.ts` filters any `ratePerThousand > 10_000` before building the envelope.

**per_employee_flat coverBasis for "per insured person" rates.** Plans whose slip note says "$X per insured person" or "per head" get `coverBasis: per_employee_flat`. The post-merge pipeline in `runner.ts` (`fixPerEmployeeFlatRates`) converts any `ratePerThousand` → `fixedAmount` on PremiumRate rows belonging to such plans. If a flat-rate plan still shows `ratePerThousand` after extraction, check whether the plan's `coverBasis` was extracted correctly.

**Declared premiums come from header.declaredPremium on each ExtractedProduct.** `reconciliation.ts` reads `p.header.declaredPremium?.value` per product to populate `ReconciliationLine.declared`. If declared is null for a product, the slip's header block didn't contain an "Annual Premium" figure, or the AI didn't extract it — check the prompt's "declared premium" instruction in `prompt-product.ts`.

**Split-range grade labels span the full extent.** The grade-range pattern in `predicate-patterns.ts` handles "Grade 08 to 10 / 11 to 17" (split labels where both sides of the `/` describe the same plan population). It emits `>= min(lo1, lo2) AND <= max(hi1, hi2)`, i.e. `>= 8 AND <= 17`. Do not add separate patterns for the two halves.

**Grade predicate patterns — "Hay Job" prefix is optional.** All grade patterns in `PREDICATE_PATTERNS` (`predicate-patterns.ts`) accept both "Hay Job Grade N" and bare "Grade N" forms via `(?:Hay\s*Job\s*)?Grade`. Supported variants: "Grade N and above" / "Grade N & above" / "Grade N+" → `>=`; "Grade N and below" / "Grade N & below" → `<=`; "Grade X to Y" / "Grade X - Y" → range; "Grade X & Y" (two specific values joined by `&`) → `or [{==,X},{==,Y}]`; "Work Permit & S-Pass" as well as "Work Permit or S-Pass" → FW filter. If groups show an empty `{}` predicate when the label clearly names a grade, check whether the label uses a variant not yet covered by these patterns — add it to `PREDICATE_PATTERNS` before concluding the predicate is intentionally empty.

**Employee schema has hay_job_grade, firefighter, manual_worker as disabled STANDARD fields.** These live in `packages/shared-types/src/employee-schema.ts` under `STANDARD_FIELDS` with `enabled: false`. Brokers activate them via the Schema Additions step when predicates reference them. `NON_BARGAINABLE` is also a valid `employment_type` enum value alongside `BARGAINABLE`, `INTERN`, `CONTRACT`.

**Shared front-end utilities — use these, don't re-implement.** `src/lib/format-date.ts` exports `formatDate(d: Date | string | null | undefined): string` (ISO date or "—"). `src/lib/employee-display.ts` exports `employeeDisplayLabel(data)` (reads `employee.full_name`, falls back to first non-empty string field, then "(no name)"). `src/lib/cover-tier.ts` exports `deriveCoverTier(dependents)` and `collapseTier(tier, supported)`. `src/lib/employee-import.ts` exports `UPLOAD_TEMPLATE_COLUMNS`, `PLAN_OVERRIDE_COLUMNS`, and transform helpers for the broker CSV template.

**Employee detail page has Profile + Entitlements tabs.** `/admin/clients/[id]/employees/[employeeId]` renders `EmployeeDetailScreen` which eagerly fetches both `employees.byId` and `employees.entitlements`. The entitlements query returns enriched enrollment rows (product type, plan, benefit group, cover tier, matching premium rate). Rate lookup uses a Map keyed by `planId:coverTier` with a `planId:*` wildcard fallback for null-coverTier rates.

---

Update this file whenever a convention solidifies or a recurring confusion appears. It is the first thing a fresh Claude Code session reads, and it should reflect reality.
