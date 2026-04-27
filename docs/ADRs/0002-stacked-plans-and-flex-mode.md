# ADR 0002: Stacked plans, flex mode, effective-dated schedules, per-entity rate overrides

Date: 2026-04-27
Status: Accepted

## Context

The [REDACTED] 2026 placement slip exercised four product-modelling capabilities that the v1 brief's schema didn't support. Each one is on the critical path for parsing STM cleanly (acceptance test in `docs/PHASE_1_BUILD_PLAN_v2.md` §9, scenario 3):

1. **Stacked rider plans.** STM's GTL has Plan B (base) and Plan C / Plan D, where Plan C and D are *additive riders on top of* Plan B rather than alternatives. An employee on "Plan C" is in fact covered for Plan B + Plan C combined. Treating them as alternatives understates cover and overstates premium fragmentation.
2. **Employee-flex selection.** STM offers "Flex S / M / MC / MC2" tiers where the employee picks at enrolment time, not the broker at configuration time. The default-plan-per-group model assumes the broker picks a single plan per benefit group, which doesn't fit.
3. **Mid-year benefit-schedule changes.** STM's policy spans 2026 but includes a row-and-board uplift effective halfway through the year. Single-row schedules can't represent this; eligibility and premium calc need to know which row applies on a given date.
4. **Per-entity rate overrides.** STM has three legal entities under a master policy. One has a different GHS premium rate from the other two due to a side agreement with the insurer. Storing rates only at the product level forces either (a) duplicating the product across entities or (b) shoehorning entity-specific rates into JSONB lookup tables — both ugly.

We need these capabilities general enough to apply to future clients, not patched in for STM.

## Decision

Make four schema additions:

**1. `Plan.stacksOn String?`** — null for base plans; set to another Plan's ID for riders. The Prisma model declares a self-relation `riderOf` / `riders` so the eligibility engine and premium calc can walk the stack. When a benefit group's default plan is a rider, the engine applies the rider's schedule on top of its base.

**2. `Plan.selectionMode String @default("broker_default")`** — accepted values `"broker_default"` and `"employee_flex"`. In `broker_default` mode the broker picks one plan per benefit group at config time (current behaviour). In `employee_flex` mode the broker exposes a set of plans and the employee picks at enrolment (Phase 2 surface).

**3. `Plan.effectiveFrom / effectiveTo DateTime?`** — null = applies for the whole BenefitYear. When set, the Plan's `schedule` and any `PremiumRate` rows referencing it apply only within the date range. Multiple Plans with the same `code` can coexist if their effective ranges don't overlap; the eligibility engine selects by date.

**4. `PolicyEntity.rateOverrides Json?`** — null = inherit rates from product/plan. When set, it's a JSON object keyed by `productId` carrying overrides for one or more PremiumRate rows. The premium calc resolves rates in order: entity override → plan-level rate → product-level rate.

These four additions live on the v2 schema in `prisma/schema.prisma`. They are deliberately schema-level (not JSONB blobs) because they need to be queried, validated by FK, and surfaced by the predicate builder UI.

## Consequences

**What becomes easier:**

- STM's GTL Plan B + C / D rider relationships are first-class; the eligibility engine doesn't need product-specific code to apply both.
- Phase 2 employee-flex picker UI can read `selectionMode` directly without inferring from heuristics.
- Mid-year amendments don't require a new BenefitYear when the change is a Plan-level uplift.
- One legal entity carrying a bespoke rate doesn't pollute the rest of the master policy.

**What becomes harder:**

- The premium strategy interface (`apps/web/src/server/premium-strategies/`) must accept an optional date and an optional `PolicyEntity` to resolve effective dates and rate overrides. Each strategy needs explicit handling rather than a blanket "find latest rate" pass.
- The validation engine (Screen 6) has to detect:
  - circular `stacksOn` references (Plan A stacks on B, B stacks on A → blocker),
  - overlapping effective ranges with the same `code` (likely a data-entry error → warning),
  - rate overrides referencing PremiumRate IDs that don't exist (blocker).
- The parser review screen (Story S32) has to surface "this plan looks like a rider — pick a base plan to stack on" for plans the parser couldn't disambiguate.

**What we'd revisit:**

- If `selectionMode = "employee_flex"` ends up needing additional metadata (employee co-pay, flex points, picker rules), promote it from a string field to its own table. For Phase 1 a string is enough.
- If rate overrides at multiple levels (entity, group, plan) need to compose, formalise the resolution order beyond entity → plan → product. The current order is sufficient for STM.

## Alternatives considered

**Modelling stacked plans via PremiumRate composition only.** I.e. give Plan C its own full schedule (base + rider combined) and let it stand alone. Rejected because (a) the broker UI would have to maintain duplicated schedules and (b) the placement slip clearly *describes* it as a rider, not as a self-contained plan — the data shape should match the document shape.

**Modelling flex tiers as separate Products.** I.e. one Product per flex tier. Rejected because the tiers share an insurer, a benefit-group eligibility, a parsing rule — they're plans of one product, not separate products. The `selectionMode` field captures the "who picks" question without splitting Products.

**Putting effective dates on PremiumRate only.** Rejected because the schedule (e.g. daily room-and-board cap) also changes mid-year, not just the rate. Effective dates belong on the Plan because that's where the schedule lives.

**Per-entity products.** I.e. duplicate the Product row per PolicyEntity to carry per-entity rates. Rejected because (a) it inflates the data model 3× for STM (and N× for any future multi-entity client), (b) it confuses the audit trail, and (c) it makes "this Product across all entities" queries harder. Override JSON on the entity row is the leanest option that preserves a single source of truth per Product.
