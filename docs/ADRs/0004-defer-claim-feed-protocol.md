# ADR 0004: Defer `Insurer.claimFeedProtocol` until S35

Date: 2026-04-27
Status: Accepted

## Context

`PHASE_1_BUILD_PLAN_v2.md` §2.6.1 defines `Insurer.claimFeedProtocol String?` (values "IHP" / "TMLS" / "DIRECT_API" / null) as a routing key that tells the claims-ingestion pipeline how to dispatch incoming files for each insurer. §3.4 seeds 6 insurers each with a specific protocol value, and §8 S8 makes "claimFeedProtocol = IHP" part of the Insurer-Registry-CRUD acceptance criterion.

S8 landed with the field wired through the schema, the tRPC router, and the create/edit forms. When reviewing the staging UI, the user noticed that no application code reads the column today — claims feed routing only matters from S35 ("TPA claims feed (IHP) — sample IHP claim feed CSV ingested"). Asking admins to fill in the field now means they have to guess values for a non-functional input, and the seeded enum values are best-guess from the placement-slip notes rather than verified against real protocols.

## Decision

Drop `Insurer.claimFeedProtocol` from the schema, the shared-types catalogue, the tRPC input/output types, and the UI now. Re-add it as part of S35 when the actual claims-ingestion pipeline lands and we know exactly what values it needs to dispatch on.

What this means concretely:

- Migration `20260427081919_drop_insurer_claim_feed_protocol` drops the column.
- `CLAIM_FEED_PROTOCOLS` and the `ClaimFeedProtocol` type removed from `packages/shared-types/src/catalogue.ts`.
- `insurersRouter` input schema loses the `claimFeedProtocol` key; the create/edit forms lose the dropdown; the list table loses the column.
- S8's PROGRESS.md entry now reads "claimFeedProtocol deferred until S35" so the gap is visible.
- The TPA registry (S9) is unaffected — `TPA.feedFormat` is a different concept (wire format like "CSV_V1" vs protocol class) and stays.

## Consequences

**What becomes easier:**

- The Insurer form has one fewer field to explain. Admins can add insurers without hunting for the right protocol value.
- The seed data (when we eventually add the 6 §3.4 insurers) doesn't carry guessed values that future-S35 work has to either honour or migrate around.
- Less API surface = less validation, less testing, less doc.

**What becomes harder:**

- S8's plan AC ("add Tokio Marine Life with productsSupported = [...] and claimFeedProtocol = IHP") is **partially unsatisfiable** as written. The first half (productsSupported) still works; the second half is a documented deferral.
- When S35 lands, every existing Insurer row will need `claimFeedProtocol` backfilled — either by the admin via the UI or by a data migration with sensible defaults derived from the §3.4 reference table.
- If an analyst reads the v2 plan first, they'll expect the column to be present and may file a "missing field" bug. The PROGRESS.md note + this ADR are the answer.

**What we'd revisit:**

- If S35 reveals that the protocol routing key actually belongs on `Policy` (because different policies from the same insurer can route differently — e.g. Tokio Marine GHS via IHP but Tokio Marine GTL direct), we'd add it there instead. The deferral lets us learn that from the real claims data instead of pre-committing.

## Alternatives considered

**Keep the field, mark it optional, document it as "future use".** Carries a non-functional control in the UI for ~25 stories. Admins fill in guesses; we then have to either honour or migrate those guesses at S35.

**Keep the field but hide the UI control.** Hidden fields rot. The next person to touch the form has to re-discover why the column exists with no UI.

**Defer the entire S8 story until S35 unblocks claimFeedProtocol.** Insurer Registry is a hard prerequisite for every later registry/onboarding story (S15 product selection filters by `productsSupported`, S29 parser registry routes by insurer). Deferring S8 stalls the pipeline.

## Re-add path (when S35 lands)

1. Add `claimFeedProtocol String?` back to `model Insurer`.
2. New migration: `ALTER TABLE "Insurer" ADD COLUMN "claimFeedProtocol" TEXT;`
3. Re-introduce `CLAIM_FEED_PROTOCOLS` in shared-types — but **derive the enum from S35's actual parser-registry needs**, not from the §3.4 reference table.
4. Add the dropdown back to insurer forms; surface the column in the list table.
5. Backfill: either via the admin UI (preferred — admins know the right values) or via a one-shot migration if the §3.4 table holds up against S35 reality.
6. Tick the Phase 1 Definition of Done item that S35 will cover (claims feed pipeline operational).
