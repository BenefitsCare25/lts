# Claude Code Build Brief — Insurance SaaS Platform

> **⚠ Superseded.** This brief is kept for historical reference only. The canonical Phase 1 plan is **[`docs/PHASE_1_BUILD_PLAN_v2.md`](PHASE_1_BUILD_PLAN_v2.md)**. Where this brief and v2 disagree (Agency vs Tenant, four schemas vs two-plus-strategy, 26 stories vs 35, the absence of registries / EmployeeSchema / Pool / TPA / stacked plans), **v2 wins**. Do not start a new story from this document.

Phase 1 build plan for a solo developer working with Claude Code as pair. Reads alongside the two prior docs: `insurance_saas_platform_plan.md` (breadth) and `dynamic_product_architecture.md` (depth on the catalogue). This brief says what to build, in what order, on what stack, and with what acceptance criteria.

---

## 1. What we're building

A multi-agency, white-label SaaS platform for insurance brokerage agencies to ingest placement slips, structure them into a versioned product catalogue, and publish policy configurations ready for employee-facing consumption. Phase 1 stops at the broker admin experience — the ingestion and catalogue management side. Employee portal is Phase 2.

The platform replaces the existing Inspro tooling. Each client's data is rebuilt from their latest placement slip — no Inspro migration needed.

## 2. Locked decisions

These decisions are made. Do not revisit them in Phase 1 without an explicit reason.

**Architecture pattern.** Metadata-driven product catalogue as described in `dynamic_product_architecture.md`. Every product type (GTL, GHS, GPA, GMM, GCI, GDI, Dental, FWM, SP, GP, GBT, WICI) is defined as data — a JSON Schema stored in the database. Product instances are JSONB columns validated against the catalogue on every write. No hardcoded product-specific logic in application code.

**Tenant model.** Multi-agency white-label from day one. Every row belongs to an `agency_id`. Every query filters by agency. Tenant isolation is enforced at the middleware layer and defence-in-depth at the database layer via row-level security.

**Tech stack.**
- Runtime: Node.js 20 LTS, TypeScript strict mode.
- Framework: Next.js 15 with App Router, running as a single full-stack app.
- Database: PostgreSQL 16.
- ORM: Prisma 5.
- Auth: WorkOS AuthKit, with WorkOS Organizations as the agency tenant boundary.
- Validation: Ajv for JSON Schema (catalogue and instances), Zod for API route inputs.
- Forms: `@rjsf/core` (react-jsonschema-form) for schema-driven admin forms.
- Rules: `json-logic-js` for benefit group predicates.
- Excel: `exceljs` for placement slip parsing (handles both `.xls` and `.xlsx`).
- Background jobs: BullMQ with Redis backend.
- File storage: Azure Blob Storage for placement slip uploads and generated documents.
- Testing: Vitest for unit and integration, Playwright for end-to-end.
- Linting: Biome (lint + format in one tool).
- Package manager: pnpm.

**Hosting.** GitHub for source and CI, Azure for deployment, all in Southeast Asia (Singapore) region.
- App runtime: Azure Container Apps (single container running the Next.js app, scales to zero option).
- Database: Azure Database for PostgreSQL Flexible Server (Burstable tier, scale up as needed).
- Redis: Azure Cache for Redis (Basic tier).
- Object storage: Azure Blob Storage (Standard, LRS).
- Secrets: Azure Key Vault referenced from Container Apps.
- Observability: Azure Application Insights.
- Infrastructure as code: Bicep templates committed to the repo.

Estimated MVP cost at lowest tiers: S$110–200/month.

**Scope: Core MVP.** Catalogue management, placement slip import, publish workflow, full admin data views. No employee portal, no claims data feeds, no TPA integrations, no billing. Agency and client setup happen through an admin UI but keep it simple — fancy wizards are a Phase 2 polish.

## 3. Architecture summary

Three layers. Read `dynamic_product_architecture.md` for the full treatment.

*Relational core* — fixed tables: Agency, User, Client, PolicyHoldingEntity, Insurer, Policy, PolicyVersion, BenefitGroup, Employee, Dependent (Employee and Dependent tables exist from day one but are lightly used in Phase 1 — full enrollment logic is Phase 2).

*Product catalogue* — ProductType and ProductTypeVersion tables hold JSON Schemas, ingestion templates, display templates, calculation strategy references. Immutable versions; changes publish new versions.

*Product instances* — Product, Plan, PremiumRate, BenefitSchedule tables reference a ProductTypeVersion and store their specifics in JSONB. Every write validates against the referenced version's schema through Ajv.

Below these, four surfaces auto-generate from the catalogue: the admin form (via `@rjsf/core`), the Excel parser (via template-driven extraction), the display renderer (stub in Phase 1, full in Phase 2), the API output format (Zod schemas derived from catalogue).

## 4. Repo structure

```
insurance-saas/
├── .github/
│   └── workflows/
│       ├── ci.yml                  # lint, typecheck, test, build on push to main
│       └── deploy.yml              # build + deploy to Azure on main merge
├── apps/
│   └── web/                        # the Next.js app
│       ├── src/
│       │   ├── app/                # App Router pages and route handlers
│       │   │   ├── (auth)/         # sign-in, callback, etc.
│       │   │   ├── (admin)/        # broker admin surfaces (protected)
│       │   │   │   ├── catalogue/
│       │   │   │   ├── clients/
│       │   │   │   ├── policies/
│       │   │   │   ├── imports/
│       │   │   │   └── dashboard/
│       │   │   └── api/            # route handlers (tenant-scoped)
│       │   ├── server/             # server-only code
│       │   │   ├── auth/           # WorkOS integration, session helpers
│       │   │   ├── db/             # Prisma client, helpers
│       │   │   ├── catalogue/      # ProductType logic, schema validation
│       │   │   ├── ingestion/      # Excel parser, template engine
│       │   │   ├── policies/       # Policy lifecycle, publish workflow
│       │   │   ├── storage/        # Azure Blob client
│       │   │   ├── jobs/           # BullMQ worker definitions
│       │   │   └── tenant/         # tenant-scoping middleware and helpers
│       │   ├── components/         # React components (admin UI)
│       │   ├── lib/                # shared client+server utilities
│       │   └── types/              # shared TS types
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/        # DB-backed, runs against test Postgres
│       │   └── e2e/                # Playwright
│       └── package.json
├── packages/
│   ├── catalogue-schemas/          # JSON Schemas for seed catalogue entries
│   │   ├── ghs.json
│   │   ├── gtl.json
│   │   ├── gpa.json
│   │   └── ...
│   └── shared-types/               # types shared across future apps
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                     # seeds one agency, one client, catalogue
├── infra/
│   └── bicep/
│       ├── main.bicep              # full Azure infra
│       ├── modules/                # reusable modules (postgres, blob, etc.)
│       └── parameters/             # env-specific parameter files
├── docs/
│   ├── architecture.md             # reference to the deep-dive
│   ├── ADRs/                       # architecture decision records
│   └── runbooks/                   # operational procedures
├── scripts/
│   ├── dev-setup.sh                # local environment bootstrap
│   └── generate-catalogue-types.ts # TS types from JSON Schemas
├── CLAUDE.md                       # persistent context for Claude Code
├── README.md
├── .env.example
└── package.json                    # pnpm workspace root
```

This is a single-app monorepo that can grow — if you later add a mobile app, an employee portal as a separate deployment, or a shared component library, the structure accommodates it without a major refactor.

## 5. Pre-story setup (Claude Code's first session)

Before the first story card, Claude Code should complete environment bootstrap. Expect this to be a single session.

1. Initialise the GitHub repo from this brief. Set up pnpm workspaces, Biome config, Vitest config, Playwright config, TypeScript strict config.
2. Scaffold Next.js 15 with App Router under `apps/web`, configured with the directory layout above.
3. Set up Prisma with a Postgres connection (use a local Docker Postgres for dev — docker-compose.yml with Postgres 16, Redis 7).
4. Commit an initial `CLAUDE.md` (provided separately) to the repo root.
5. Commit an initial `schema.prisma` (provided separately).
6. Write a `scripts/dev-setup.sh` that brings up Docker, runs migrations, seeds catalogue.
7. Set up GitHub Actions workflow for CI (typecheck, lint, unit tests, build) triggered on every push to `main`.

**Verification before proceeding to Story 1:** Fresh clone plus `./scripts/dev-setup.sh` should yield a working local app at `localhost:3000` with a seeded database.

## 6. Phase 1 user stories

Stories are scoped to 1–5 days of work for a solo developer paired with Claude Code. Each story has explicit acceptance criteria that map to automated tests. Sequence is dependency-aware — do not reorder without thinking about upstream dependencies.

### Epic 1 — Foundation (5 stories)

**S1. Azure infrastructure as code.**
Bicep templates for: Container Apps environment + single app, Postgres Flexible Server (Burstable B1ms, 1 vCPU, 2GB), Redis (Basic C0), Blob Storage account with a `placement-slips` container, Key Vault with managed identity access from Container App, Application Insights. Parameter files for `staging` and `production`. Document the `az login` plus `az deployment` commands to apply.
*Done when:* running the deployment against a clean Azure subscription produces a reachable Container App URL (even with a placeholder image) plus a Postgres instance reachable from it.

**S2. GitHub Actions CI/CD.**
CI workflow on every push to `main`: install, typecheck, lint, unit tests, build. On CI success, the same workflow (or a triggered CD job) builds the Docker image, pushes to Azure Container Registry, and deploys to staging Container App. Use GitHub OIDC federated identity for Azure auth — no long-lived secrets.
*Done when:* a push to main results in a deployed staging app within 10 minutes.

**S3. WorkOS AuthKit integration.**
Install WorkOS SDK. Create sign-in, sign-out, and callback routes. Store WorkOS user id plus organization id in session. Create middleware that rejects unauthenticated requests to `(admin)` routes. Set up WorkOS dashboard for the dev organization and configure at least one test user.
*Done when:* hitting `/admin/dashboard` unauthenticated redirects to WorkOS; signing in returns to the app with a session containing user and organization identifiers.

**S4. Agency and User models with tenant-scoping middleware.**
On first sign-in from a WorkOS user, create or update an Agency row mirroring the WorkOS Organization and a User row linked to both. Build a `requireAgencyContext()` helper that any server action or route handler calls to get a scoped Prisma client (every query auto-filters by `agency_id`). Include Prisma middleware that rejects any query touching a tenant-scoped table without an `agency_id` filter.
*Done when:* server code cannot read or write tenant data without an agency context; unit tests assert a query without agency context throws.

**S5. Base admin layout and navigation.**
Shared layout for `(admin)` routes: top bar with agency name plus user menu, side nav with links to Dashboard, Clients, Policies, Catalogue, Imports. Empty landing pages for each. Design kept intentionally simple — we polish in Phase 2.
*Done when:* all admin routes render a consistent shell; navigation works; no per-page layout code.

### Epic 2 — Data foundation (3 stories)

**S6. Relational core Prisma schema.**
Port the provided `schema.prisma` for the relational core (Agency, User, Client, PolicyHoldingEntity, Insurer, Policy, PolicyVersion, BenefitGroup, Employee, Dependent). Generate migration. Verify tenant columns, foreign keys, indexes.
*Done when:* migration runs cleanly against a fresh Postgres; Prisma Studio can browse all tables.

**S7. Catalogue schema.**
ProductType plus ProductTypeVersion tables. Product, Plan, PremiumRate, BenefitSchedule instance tables with JSONB fields and a `product_type_version_id` FK. Add the AuditLog table.
*Done when:* tables exist; a seed script creates one ProductType with one Version; Prisma Studio browsing works.

**S8. Seed data for development.**
A `prisma/seed.ts` that creates: one Agency ("Demo Brokers"), one User (you), two Clients (CUBER AI, Balance Medical mimics), three Insurers (Tokio Marine Life, Zurich, Great Eastern), and three catalogue ProductTypes (GHS, GTL, GPA) with real JSON Schemas derived from the CUBER placement slip. Provided as starter files under `packages/catalogue-schemas/`.
*Done when:* `pnpm prisma db seed` produces a usable dev dataset; admin UI lands on a non-empty catalogue view.

### Epic 3 — Product catalogue (4 stories)

**S9. Schema validation infrastructure.**
Wrap Ajv with a `CatalogueValidator` service that: loads schemas from ProductTypeVersion rows, compiles them once, caches compiled validators in memory keyed by `(type_code, version)`. Expose `validateProduct(data, typeCode, version)`, `validatePlan(...)`, `validateSchedule(...)`, `validateRate(...)` — each returns structured errors on failure.
*Done when:* unit tests cover: valid CUBER GHS data passes, invalid data returns errors with field paths, unknown schema version throws.

**S10. ProductType CRUD and versioning.**
Admin UI and server actions for: list ProductTypes, view a ProductType (including all its versions), create a new ProductType (initial version 1), publish a new version of an existing type. The editor uses a JSON editor component (try `@monaco-editor/react`) for each of the four schemas (`schema_product`, `schema_plan`, `schema_schedule`, `schema_rate`) plus the ingestion template. Versions are immutable once published.
*Done when:* you can create a new "Test Product" type through the UI, publish v1, then create and publish v2 with a new field, and the old v1 remains readable.

**S11. Catalogue browser.**
Read-only view listing all ProductTypes in the agency's catalogue with: code, name, category, latest version, status. Click through to the ProductType detail view showing each version and its schemas rendered in a readable form (not raw JSON — use a formatted tree view).
*Done when:* seeded GHS, GTL, GPA show up; detail view renders the full schemas cleanly.

**S12. ProductType form preview.**
On a ProductType detail page, include a "Preview form" tab that renders `@rjsf/core` using the `schema_product` plus a configured `ui:schema`. This is the same form brokers will fill in when creating a product instance; showing it here validates the schema is practical to fill in.
*Done when:* GHS preview form renders all expected fields; submitting validates and shows the resulting object.

### Epic 4 — Policy and client setup (4 stories)

**S13. Client and PolicyHoldingEntity CRUD.**
Admin UI for create/edit/list clients. Each client can have multiple PolicyHoldingEntities (for the STM-style case). Simple forms — name, UEN, address, business description. No wizard.
*Done when:* you can create CUBER AI with one entity, and STM with three entities; list view shows both.

**S14. Policy + PolicyVersion models.**
Admin UI for creating a Policy against a client: pick PolicyHoldingEntity, pick Insurer, set policy number, set policy period (start and end dates). On save, creates a PolicyVersion in `draft` status. UI shows the current draft or published version and provides a version history sub-page.
*Done when:* CUBER's 2025-26 policy with Tokio Marine can be created through the UI; a PolicyVersion in `draft` status exists.

**S15. Product instance management.**
Under a PolicyVersion, add products from the catalogue. Form is auto-generated from the ProductType's `schema_product` via `@rjsf/core`. Save validates against the catalogue. Product detail view lets you add Plans (via `schema_plan` form), the schedule of benefits (via `schema_schedule` form), and PremiumRates (via `schema_rate` form). Every write validates; invalid data blocks save with field-level error messages.
*Done when:* the full CUBER GHS data from the placement slip can be entered through forms and saved as a validated draft.

**S16. BenefitGroup management with predicate builder.**
A BenefitGroup has a name and a JSONLogic predicate over employee attributes. Build a simple predicate builder UI: add condition (field, operator, value), combine with AND or OR. Save as JSONLogic JSON. Include a "test against sample employee" sidebar where the user enters mock employee attributes and sees which groups match.
*Done when:* STM-style predicates ("nationality in [SG,PR] AND hay_job_grade >= 18") can be built and tested.

### Epic 5 — Excel placement slip ingestion (4 stories)

**S17. File upload pipeline.**
Upload form accepting `.xls` and `.xlsx` up to 20MB. Streams to Azure Blob Storage under `{agency_id}/placement-slips/{uuid}/{filename}`. Creates an IngestionJob row in `pending` status. Returns job ID.
*Done when:* uploaded files land in Blob Storage; IngestionJob row references the blob URL; jobs list page shows pending imports.

**S18. Parser core using ingestion templates.**
Worker reads the IngestionJob, downloads the file, opens with `exceljs`, iterates sheets. For each sheet, tries every ProductType's `sheet_matchers` to detect product type. For matched sheets, applies the ingestion template (header fields plus schedule section rules) to extract values. Output: a tree of extracted values with a `confidence` field per extraction, plus a list of unmatched rows. Save the extracted draft against the IngestionJob.
*Done when:* parsing the CUBER AI workbook produces structured output matching the seeded catalogue templates; unmatched rows are flagged; confidence scores are present.

**S19. Parse review UI.**
After a job completes, a review page shows: the source file preview (optional — can skip if complex), the extracted values grouped by product type, flagged low-confidence extractions highlighted, inline edit fields for every value. A "Commit" button creates Policy, PolicyVersion, Products, Plans, Rates, BenefitSchedules from the reviewed data — all in `draft` status.
*Done when:* CUBER workbook uploaded, parsed, reviewed, and committed produces the same draft data as Story 15's manual entry path.

**S20. BullMQ background job queue.**
Migrate parser execution from synchronous to a BullMQ queue backed by Azure Redis. Worker runs in the same Container App but on a separate concurrency pool. Handle retries (max 3), poison messages (dead-letter queue), progress updates back to the IngestionJob row.
*Done when:* uploading a file returns immediately; the UI polls or subscribes to job status updates; a deliberately-broken file retries then lands in dead-letter.

### Epic 6 — Publish workflow (3 stories)

**S21. PolicyVersion state machine.**
Enforce transitions: `draft → in_review → published → superseded`. Only `published` versions are visible to downstream consumers (when they exist in Phase 2). When transitioning to `published`, validate everything (all products, plans, schedules, rates against their catalogue versions) and snapshot. When a new version is published for the same Policy, the previous `published` version transitions to `superseded` atomically.
*Done when:* state machine is enforced via Prisma constraints plus application logic; unit tests cover all transitions and illegal transitions throw.

**S22. Publish UI.**
On a PolicyVersion detail page, a "Publish" button that: runs full validation, shows errors if any, and on success transitions the state. Show a prominent banner when viewing a draft or superseded version. Allow comparing two versions side-by-side (simple left/right view of the JSONB data).
*Done when:* publishing CUBER's 2025-26 policy transitions it to `published`; can create a 2026-27 draft alongside; publishing 2026-27 marks 2025-26 as superseded.

**S23. Audit trail.**
Every create, update, publish, unpublish on Client, Policy, PolicyVersion, Product, Plan, PremiumRate, BenefitSchedule, BenefitGroup, ProductType writes an AuditLog row with: `agency_id`, `user_id`, action, entity type, entity id, before JSON, after JSON, timestamp. Admin UI under each entity shows its audit history.
*Done when:* modifying a policy in the UI shows up immediately in its audit history; audit is tenant-scoped (agency A cannot see agency B's audit entries).

### Epic 7 — Admin views (3 stories)

**S24. Agency dashboard.**
Landing page shows: count of active policies, count of clients, recent imports (last 10), pending drafts (policies with unpublished drafts). Each card links to its detail view.
*Done when:* seeded data produces a populated dashboard; counts update when data changes.

**S25. Client detail view.**
For a client: summary info, list of policy-holding entities, list of policies grouped by benefit year (published) or status (drafts). Links to each policy's detail view.
*Done when:* CUBER client page shows the 2025-26 policy; STM client page shows the three-entity structure.

**S26. Policy detail view.**
For a policy: current version (published or latest draft), all products under it with their plans and rate grids, benefit groups with their predicates. Rendered using the display templates from each product type's catalogue entry (simple in Phase 1 — Phase 2 upgrades the templates).
*Done when:* CUBER's GHS policy detail page shows the full schedule with plan 1 and plan 4 values, the EO/ES/EC/EF rate grid, and the two benefit groups.

## 7. Deferred to Phase 2 (explicitly out of scope)

Calling this out so nobody drifts into it mid-build:

- Employee self-service portal
- Claims data feed from TPA (IHP, TMLS, etc.)
- Outbound census file generation for insurers
- HR admin portal at the client side
- Panel clinic directory
- Wallet, employee events, dependent events (processing)
- Billing and invoicing
- Multi-language (platform is English-only in Phase 1)
- Full rate calculation engine (premiums are stored as-entered; no recalculation)
- Distinct staging plus production infra separation (single environment is fine until employees are on it; staging comes in Phase 2)

## 8. Initial catalogue seed content

The seed script creates three ProductTypes built from real CUBER AI placement slip data. The schemas are in `packages/catalogue-schemas/` as separate JSON files per product type. Starter content for each:

**GHS v1.** Full schema per `dynamic_product_architecture.md` section 5, plus an ingestion template matching the CUBER GHS sheet row labels, plus a minimal display template that lists each section.

**GTL v1.** Full schema per section 6. Ingestion template matches the CUBER GTL sheet.

**GPA v1.** Start simple — schema captures Basis of Cover (per individual sum assured or multiple of salary), accidental death, TPD, medical expenses, weekly income. Ingestion template for the CUBER Zurich GPA sheet.

More product types (GMM, Dental, SP, GP, WICI, GBT, GCI, GDI, FWM) are added post-Phase-1 through the catalogue admin UI — no code changes needed. That is the promise of the architecture; Phase 1 proves it with three types.

## 9. Security and compliance notes for Phase 1

Even before the platform touches live claims data, these are mandatory:

- All data at rest encrypted (Azure PostgreSQL and Blob Storage handle this by default; ensure TDE is on).
- All data in transit encrypted (TLS 1.2+ enforced at Container App level).
- Tenant isolation enforced in middleware and via Postgres RLS policies as defence in depth.
- Audit log is immutable — implement as append-only with trigger-based rejection of updates/deletes.
- Secrets exclusively in Key Vault, accessed via Container App managed identity. Zero secrets in code or environment files committed to git.
- Session hardening — secure, HTTP-only, SameSite=Lax cookies, session timeout configurable per agency.
- Rate limiting on public routes (sign-in, callback) to prevent enumeration.
- Content Security Policy headers configured.
- The `sg-enterprise-security` skill in this project covers PDPA, MAS TRM, and OWASP detail — consult it before any production deployment and at Epic-6 and Epic-7 reviews.

## 10. How to use this with Claude Code

Start a Claude Code session with the repo checked out. Point Claude Code at this brief plus `CLAUDE.md` (committed at repo root). For each story, feed Claude Code the story block from section 6 and ask it to implement. Claude Code will break it down further into its own sub-tasks.

Keep stories in flight to one at a time. Push completed work directly to `main` — no feature branches, no pull requests. Each story produces a focused series of Conventional Commits (one concern per commit) on `main`. Run the full local check suite (`pnpm typecheck && pnpm check && pnpm test && pnpm build`) before pushing; the CI workflow re-runs the same gates on every push and triggers the staging deploy on success. Test on staging. When the story's acceptance criteria pass on staging, close the story and move to the next.

The git history is the change log — commit messages need to stand on their own without a PR description to lean on. Treat the first line as the changelog entry; only use a body when the *why* genuinely needs more space than the title affords.

Update `CLAUDE.md` as conventions solidify and pitfalls emerge. Future Claude Code sessions pick up the evolved context automatically.

Between epics, pause and audit: do the completed stories compose the way the architecture intends? If something feels off, consult the architecture doc, decide, write an ADR under `docs/ADRs/`, and course-correct before the drift compounds.

## 11. First week checklist

Before starting Story 1 proper, these house-keeping items are worth doing:

- Set up the Azure subscription with a dedicated resource group for the project.
- Sign up for WorkOS, create a project, create a dev organization, configure SSO or Magic Link auth for your own account.
- Create the GitHub repo (private), initialise with this brief, `CLAUDE.md`, and the starter Prisma schema.
- Install pnpm, Node 20, Docker Desktop, Azure CLI, Bicep CLI locally.
- Create a dev Azure Key Vault and store WorkOS API key, WorkOS Client ID, Postgres credentials (even if unused locally).
- Write or verify the `scripts/dev-setup.sh` bootstrap script.

Only then start S1.
