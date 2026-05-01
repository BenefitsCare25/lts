# Extraction implementation guide

The single source of truth for what the extraction pipeline must produce, what's currently missing, and how to verify correctness. Replaces the previous scatter of READMEs and per-fixture notes files.

---

## Goal

Convert a placement-slip workbook into an `ExtractionDraft` envelope that populates **every cell of the 10-section Create Client wizard** with no broker re-entry beyond confirmation.

The wizard reads from one place — `ExtractionDraft.extractedProducts` (validated against `packages/catalogue-schemas/extracted-product.json`) plus `ExtractionDraft.progress.suggestions`. There is no per-section data fetch; the extractor's output IS the form state.

---

## The 10 wizard sections

Section list lives in `apps/web/src/app/admin/clients/new/import/[uploadId]/_components/sections/_registry.ts`. Each section reads a slice of the envelope:

| # | Section | Field source | What "populated" means |
|---|---|---|---|
| 1 | Source file | `PlacementSlipUpload` row | Filename, sheet count, upload timestamp shown read-only |
| 2 | Client details | `proposedClient` | legalName, address, UEN, industry, country, contact pre-filled |
| 3 | Policy entities | `proposedPolicyEntities[]` | All entities listed; one marked `isMaster` |
| 4 | Benefit year | `proposedBenefitYear` | startDate + endDate matching slip's Period of Insurance |
| 5 | Insurers & pool | `proposedInsurers[]` + `proposedPool` | Each unique insurer canonicalized to a catalogue code; pool name set if any sheet has one |
| 6 | Products | `extractedProducts[]` | One Product per logical insurance product, with plans + premium rates + categories |
| 7 | Eligibility | `progress.suggestions.predicates` | JSONLogic eligibility predicates per benefit group, derived from Eligibility sheet text |
| 8 | Schema additions | `progress.suggestions.missingFields` | Fields the slip carries that aren't in the catalogue's ProductType.schema yet — broker decides whether to extend |
| 9 | Reconciliation | `reconciliation` | Per-product computed-vs-declared deltas + grand total; status flags (OK / BUNDLED / INCOMPLETE_SCHEDULE / AI_EXTRACTION_FAILED) |
| 10 | Review & apply | (whole envelope) | Summary view; Apply button calls `extractionDrafts.applyToCatalogue` |

---

## What needs to be implemented

Five categories of work, prioritized by impact on section completeness:

### 1. Catalogue gaps (data, not code)

Add insurer rows to `prisma/seeds/product-catalogue.ts`. Each one is a missing seed that prevents Section 5 (Insurers & pool) from rendering a canonical code.

| Insurer | Surfaced by |
|---|---|
| `ALLIED_WORLD` | png-2026 (GPA + WICA) |
| `BERKSHIRE` | vdl-2026 (GPA + WICA, with Berkshire / Berkshire Hathaway label variants → canonicalize to one code) |
| `HSBC_LIFE` | hartree-2026 (6 products) |
| `INCOME` | hartree-2026 (WICA) |

Likely more insurers will surface as fixture #5 (`stmicro-2026`) and future broker uploads land.

### 2. Schema additions (Prisma migration + JSON Schema updates)

These unblock proper plan / premium-rate modelling for patterns the current schema can't express:

- **`per_employee_flat` cover basis.** Per-employee per-tier rates (e.g. GHS Plan 8 in cbre-mcst-2026 — `282 × headcount = 3384`). Currently forces `coverBasis: per_cover_tier` with empty `schedule`, returning `INCOMPLETE_SCHEDULE` from reconciliation. Surfaced by every fixture except png-2026.
- **`Product.bundledWithProductCode`.** "GCI = Additional from Group Term Life" (hartree-2026) — GCI rides on GTL's premium. Also "Premium includes GP & SP" (vdl-2026). Without this field, Section 9 reconciliation double-counts.
- **Multi-parent plan stacking.** Slip patterns where Plan D stacks on both A and B. Today `Plan.stacksOnRawCode` is a single FK; needs join table `PlanStack`.

### 3. Parsing rules (per-ProductType data in `parsingRules`)

Recognized patterns that the workbook-to-envelope heuristic should detect and lift into structured fields, so the AI second pass receives cleaner input:

- **Min-premium clauses.** `(MIN. PREMIUM : SGD250.00 before GST)` → set `premiumRate.minPremium = 250`. Reconciliation then skips computed-vs-declared variance for that product.
- **Bundling notes.** `(Premium includes GP & SP)` → set `bundledChildren: ["GP", "SP"]` on the parent product.
- **`#VALUE!` / `#REF!` / `#NAME?` formula errors.** Treat as null + emit a workbook warning. Don't crash, don't pass `#VALUE!` to the AI as a number.
- **Bound iteration to populated cells.** Some sheets have 16k empty columns (Excel cruft). `iter_rows()` over the raw `max_column` blows up the AI prompt and gets rejected by the API. Walk only cells with non-null values.
- **Summary-sheet declared totals.** When a workbook has a `Renewal Overall Premium` (or similar) sheet listing per-product totals, prefer those for `declaredPremium` over the per-product Annual Premium row, and emit a warning when the two disagree.

### 4. Extractor logic (code under this directory)

Generic operations driven by data + workbook structure, not per-slip branches:

- **Cross-sheet aggregation.** Collapse N sheets into 1 Product when they share `(insurer, policy_number, period)`. Surfaced by vdl-2026's GHS-Locals / GHS-Secondees / GHS-Dependants. Failure mode: 3 separate Products, duplicate cards in Section 6.
- **Insurer label canonicalization.** Map slip-text variants (`Tokio Marine Life`, `Tokio Marine Life Ltd`, `TM Life`) to one catalogue code. Same insurer should never produce two `proposedInsurers[]` entries.
- **Product code aliases.** Maintain alias table on `ProductType` (e.g. `GCGP → GP`, `GCSP → SP`, `GD → Dental`, `WICA → WICI`). The extractor's product-detection step canonicalizes via this table before assigning `productTypeCode`.

### 5. Replace the regression runner stub

`apps/web/tests/extraction/regression.test.ts` currently calls a stub at the TODO marker (line ~85). Replace with a real call to `runExtractionForFixture(fixtureName, slipBuffer, expected)` that:

1. Spins up a testcontainers Postgres
2. Seeds the catalogue (uses `prisma/seeds/product-catalogue.ts`)
3. Calls the extractor end-to-end against the fixture's `slip.xlsx`
4. Returns the envelope for the comparator to score

Once wired, flip the test gate to `expect(score.score).toBeGreaterThanOrEqual(floor)` and commit a `.baseline.json` so CI catches regressions.

---

## Test fixtures (4 of 5 built)

Each fixture: `apps/web/tests/extraction/fixtures/<name>/slip.xlsx` + `expected.json` + `_anonymization-audit.json`.

| Fixture | Slip-shape pattern it tests |
|---|---|
| `cbre-mcst-2026` | Simplest baseline — 5 products, single entity, single insurer. Two-year-billed-annually period. Two address fields (ACRA + Mailing). |
| `png-2026` | Workbook-level summary sheet provides declared totals. Min-premium clause on WICA. Per-product summary/sheet AP mismatch on GPA. |
| `vdl-2026` | Cross-sheet GHS aggregation (3 sheets → 1 product). Multi-jurisdiction master policy (3 entities). Bundling note `(Premium includes GP & SP)`. Legacy `.xls` source — auto-converted via Excel COM. |
| `hartree-2026` | First non-null `pool` (Insurope). `#VALUE!` formula error in WICA Annual Premium. 16k-col stress sheets. GCI as add-on to GTL. Multi-jurisdiction GBT extension. |
| `stmicro-2026` | **Not built yet** — saved for last (most complex: 7 products, 4 insurers, multi-stack). |

---

## Anonymization (how fixtures stay PDPA-safe)

Per-fixture rules live in `scripts/anonymize-rules/<fixture>.json` — **gitignored**. They contain real client identifiers, employee names, NRICs, addresses, UENs. Never commit them.

The committed `scripts/anonymize-slip.py` is a generic pipeline:

```
python scripts/anonymize-slip.py <fixture-name>     # one fixture
python scripts/anonymize-slip.py --all              # all fixtures with rules
python scripts/anonymize-slip.py --list             # list known fixtures
```

The audit JSON written next to each anonymized slip records sheet/cell/kind only — no source content — so the audit itself never leaks.

When adding a new fixture: write the rules JSON locally, run the script, manually scan the output for residual sentinels, then commit `slip.xlsx + expected.json + _anonymization-audit.json` (never the rules file).

---

## How to run the regression suite

```bash
cd apps/web
pnpm vitest run tests/extraction/regression.test.ts
```

Output is per-fixture score + per-section breakdown. Stub mode (current default) prints scores but does not enforce the floor. `EXTRACTION_RUNNER_WIRED=true` enforces `score >= _minScore`.

After wire-up, `EXTRACTION_RECORD_AI=true` re-records the AI mock (`ai-responses.json`) by hitting real Anthropic. Costs $0.50–$2 per slip. CI replays the recorded mock so it doesn't pay for AI calls.

---

## Acceptance criteria

A change ships when:

1. All existing fixtures still score `>= _minScore` (default 0.85)
2. Grand-total accuracy across fixtures has not dropped >2% from baseline (`apps/web/tests/extraction/.baseline.json`)
3. New patterns introduced by recent slips have a fixture covering them

The fixtures are the forcing function. The 10-section completeness score is the single number this whole pipeline optimizes for.
