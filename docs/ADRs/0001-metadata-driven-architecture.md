# ADR 0001: Metadata-driven architecture (v2 baseline)

Date: 2026-04-27
Status: Accepted

## Context

The original Phase 1 brief (`docs/build_brief.md`) settled on a "catalogue-as-data" idea but kept the data model relatively flat: one `Agency` tenant entity, four JSON Schemas per `ProductTypeVersion` (`schema_product`, `schema_plan`, `schema_schedule`, `schema_rate`), no first-class registries for insurers/TPAs/pools/operators, no per-tenant employee schema. As we worked through the three real placement slips (Balance Medical, CUBER AI, STMicroelectronics), several gaps surfaced:

- **STM** has three legal entities (PolicyEntity), per-entity policy numbers, mid-year benefit-schedule changes, stacked rider plans (Plan C/D stacking on Plan B), employee-flex picker (Flex S/M/MC/MC2), pool/captive arrangements with Generali, and custom employee attributes (Hay Job Grade, fire fighter flag, flex tier).
- **CUBER AI** spans Tokio Marine + Zurich + Allied World, mixes individual and group premium strategies in one slip, and includes WICI which is earnings-based.
- **Balance Medical** is the simplest case but already needs Industry/Country reference data and the GTL/GHS/GPA/WICI permutation.

None of those needs survive a "hardcode and ship" pass. We either generalise the data model or accept a per-client patchwork of custom code. The v2 plan picks the first.

## Decision

Adopt a three-tier architecture with six metadata registries, codified in `docs/PHASE_1_BUILD_PLAN_v2.md` and the Prisma schema at `prisma/schema.prisma`.

**Tiers:**

1. **Relational core** — fixed-shape tables that exist regardless of products or clients: `Tenant`, `User`, `Client`, `Policy`, `BenefitYear`, `PolicyEntity`, `Insurer`, `TPA`, `Pool`, `BenefitGroup`, `Employee`, `Dependent`, `Enrollment`, `EmployeeSchema`, `OperatorLibrary`, `ProductType`. Evolve via Prisma migrations.
2. **Product catalogue (data, not code)** — `ProductType` rows hold two JSON Schemas (`schema` for product fields, `planSchema` for plan rows including `stacksOn` and `selectionMode`) plus a `premiumStrategy` string code, parsing rules, and display template. Editable through a catalogue editor UI. Adding a new product type is a data change, not a deploy.
3. **Product instances** — `Product`, `Plan`, `PremiumRate`, `BenefitSchedule` rows store type-specific data as JSONB validated against the catalogue schema on every write.

**Six registries** drive every dropdown in every screen, with no hardcoded enums in UI code:

| Registry | Storage | Updated by |
|---|---|---|
| Global Reference | `Country`, `Currency`, `Industry` (system-seeded) | system admin (rare) |
| Insurer Registry | `Insurer` (per-tenant) | catalogue admin |
| TPA Registry | `TPA` (per-tenant) | catalogue admin |
| Pool Registry | `Pool` + `PoolMembership` (per-tenant) | catalogue admin |
| Product Catalogue | `ProductType` (per-tenant, JSON Schemas inside) | catalogue admin |
| Operator Library | `OperatorLibrary` (system-seeded once) | system admin (one-time) |

A seventh, per-tenant **Employee Schema**, sits next to the registries. Its `fields` JSON drives the predicate builder, employee admin forms, parser column mapping, and census export — without code changes per tenant.

**Tenancy.** WorkOS Organizations map 1:1 to our `Tenant`. Every tenant-scoped table has `tenantId`. Postgres row-level security policies enforce the boundary at the database layer (defence in depth); application middleware sets `app.current_tenant_id` per request. `requireTenantContext()` is the single approved entry point for tenant-scoped Prisma queries.

**Premium math** is code, not catalogue data. Five strategies cover everything in the three placement slips: `per_individual_salary_multiple`, `per_individual_fixed_sum`, `per_group_cover_tier`, `per_headcount_flat`, `per_individual_earnings`. Each is a TypeScript module under `apps/web/src/server/premium-strategies/`. Adding a new strategy requires an ADR plus code; rare.

## Consequences

**What becomes easier:**

- Adding a new insurer product (or a field to an existing one) — data edit, no deploy, no migration.
- Onboarding a new tenant with custom employee attributes (e.g. STM's Hay Job Grade) — Employee Schema edit, no migration.
- Per-tenant variations in available pools, TPAs, insurers — registry edits.
- Predicate builder generalises: it reads field types from EmployeeSchema and operators from OperatorLibrary.

**What becomes harder:**

- The schema editor (Screen 0e) is now the most consequential UI in the system. A bad schema edit breaks every form generated from it. Validation, dry-run, and versioning matter.
- Validating JSONB on every write costs CPU (Ajv compilation cached per ProductType version).
- Debugging is more layered: a wrong premium can be a strategy bug, a planSchema bug, a parser bug, or a rate-row bug. Tooling must surface the layer.

**What we'd revisit:**

- If we ship a fourth or fifth premium strategy and they all share boilerplate, factor a common base.
- If the parser turns into per-insurer code rather than data-driven rules, it's evidence the catalogue abstraction leaks; we should fix the catalogue, not accept the leak.

## Alternatives considered

**Hardcoded product types (one Prisma model per product).** Fast for the first three products, untenable by the tenth. Rejected on day-one — every brokerage has dozens of insurer-specific variants.

**Single mega-JSONB blob per product (no separate schema/planSchema).** Simpler to model but loses the ability to drive plan-row editing from a different schema than product-level fields. The two-schema split lets us put `stacksOn`/`selectionMode` in a Plan-specific schema and keep product-level fields uncluttered.

**Workflow engine (Camunda / Temporal) instead of background jobs + state on rows.** Overkill for Phase 1. Revisit if benefit-year publication grows multi-step approvals.

**Single-tenant per repo (deploy a copy per agency).** Operationally cheap to start, expensive to maintain at five agencies. The white-label requirement was locked early, and tenant isolation via RLS scales further.
