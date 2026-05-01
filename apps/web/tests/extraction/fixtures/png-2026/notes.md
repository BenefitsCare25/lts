# png-2026

**Source:** Anonymized from a real placement slip dated 2026. Original identifiers replaced; rules in the gitignored `scripts/anonymize-rules/png-2026.json`.
**Anonymized by:** Claude (under user direction), 2026-05-01.
**Anonymization audit:** see `_anonymization-audit.json` in this directory (records cells changed, no source content).

## What this fixture covers

A small slip (2 employees, 7 products, 2 insurers, 1 entity) with a **workbook-level summary sheet** (`Renewal Overall Premium`) that declares per-product totals. Tests reconciliation when declared figures come from a sheet other than the product page itself, and surfaces two real-world reconciliation gotchas (min-premium clauses).

## What's structurally interesting

- **Summary-sheet declared totals.** The first sheet `Renewal Overall Premium` lists each product, its insurer, and a single Annual Premium figure. The product sheets each have their own Annual Premium row too. When the two disagree (see GPA below), which one wins? The fixture treats the **summary sheet** as authoritative for `declaredPremium` because that's what the broker signs off on.

- **Two insurers in a small slip.** Tokio Marine Life carries 5 products (GTL/GHS/GP/SP/Dental), Allied World carries 2 (GPA/WICA). Tests insurer-grouping in the wizard's two-insurer-policy view.

- **Allied World is NOT in the seed catalogue.** `prisma/seeds/product-catalogue.ts` ships TM_LIFE / GE_LIFE / ZURICH / CHUBB / ALLIANZ. Allied World is a real, common SG insurer that a real broker will hit on day one. The extractor should either canonicalize the code (`ALLIED_WORLD`) and surface a "missing in catalogue" workbook warning, or refuse to assign a code. Either way, this fixture documents the gap — adding `ALLIED_WORLD` to the seed catalogue is a Phase 1 follow-up.

- **GPA premium discrepancy: summary 200, sheet 50.** Annual Premium row on GPA reads 50 (= 0.0005 × 100k SI). Summary sheet says 200. Real-world cause is almost certainly an undisclosed **min-premium clause** — the slip itself doesn't state it, unlike WICA. Both numbers are valid in their own context; the broker just uses 200 for invoicing. Reconciliation must accept this as a non-error.

- **WICA explicit min-premium clause.** WICA sheet ends with `(MIN. PREMIUM : SGD250.00 before GST)`. Computed wages × rate = `60000 × 0.00042 + 55000 × 0.0025 ≈ 162.7`. Declared = 250 (the floor). The extractor should not flag this as an error — the slip is internally consistent and explicit.

- **Product code naming differences.** This slip uses sheet labels:
  - `GCGP` (Group Clinical General Practitioner) → catalogue code `GP`
  - `GCSP` (Group Clinical Specialist Insurance) → catalogue code `SP`
  - `GD` (Group Dental) → catalogue code `Dental`
  - `WICI` (Work Injury Compensation, slip header `WICA`) → catalogue code `WICI`
  Tests whether the extractor canonicalizes via the catalogue's `aliases` field (Phase 2 V-7).

- **Single entity, no pool.** No `Pool` row populated on any sheet. `pool: null` expected.

- **All 7 products on a single benefit year.** Period of Insurance = 01/05/2026 – 30/04/2027 on every sheet (including the summary). No multi-year ambiguity here, unlike the cbre-mcst-2026 fixture's 2-year-billed-annually case.

## Slip data summary

| Sheet | Product code | Insurer | Headcount | SI per person | Rate basis | Rate value | Sheet AP | Summary AP |
|---|---|---|---|---|---|---|---|---|
| GTL | GTL | Tokio Marine Life | 2 | 50,000 | per S$1,000 SI | 1.30 | 130 | 130 |
| GHS (Plan 1) | GHS | Tokio Marine Life | 2 (all EO) | n/a | per employee | 360/EO | 720 | 720 |
| GCGP (Plan 1) | GP | Tokio Marine Life | 2 | n/a | per employee | 311/emp | 622 | 622 |
| GCSP (Plan 2) | SP | Tokio Marine Life | 2 | n/a | per employee | 163/emp | 326 | 326 |
| GD (Plan 1) | Dental | Tokio Marine Life | 2 | n/a | per employee | 182/emp | 364 | 364 |
| GPA | GPA | Allied World | 2 | 50,000 | per S$1,000 SI | 0.50 | **50** ⚠️ | **200** |
| WICI (Class 1) | WICI | Allied World | 1 | 60,000 wage | % of earnings | 0.00042 | 25.20 (computed) | – |
| WICI (Class 2) | WICI | Allied World | 1 | 55,000 wage | % of earnings | 0.0025  | 137.50 (computed) | – |
| WICI total | | | | | | | **250** (min-premium override) | 250 |
| **TOTAL** | | | | | | | **2,462.70** computed | **2,612** |

Discrepancy `2612 - 2462.7 = 149.3` is essentially the GPA min-premium gap (200 − 50 = 150).

## Acceptance floor

`_minScore: 0.85` (current). Raise to 0.92 once the extractor integration in `regression.test.ts` lands.

## Things to watch when extraction runs

- Does AI use the **summary sheet** declared totals or the **product-sheet** Annual Premium rows when they disagree? Fixture asserts summary wins.
- Does AI surface a workbook-level warning about the GPA discrepancy?
- Does AI flag `Allied World` as an unknown insurer (not in seed catalogue) or canonicalize to `ALLIED_WORLD`?
- WICA reconciliation: does the rule engine know to skip computed-vs-declared variance when the slip has an explicit min-premium clause?
- Product code mapping: GCGP/GCSP/GD/WICA must canonicalize to `GP/SP/Dental/WICI` via catalogue aliases.
- Multi-class product (WICA Class 1 + Class 2 in one product, two PremiumRate rows): does the extractor model this as one Product with two Plans, or two separate Products? Fixture expects one Product with two Plans.
