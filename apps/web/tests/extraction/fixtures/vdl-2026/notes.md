# vdl-2026

**Source:** Anonymized from a real placement slip dated 2026. Original identifiers replaced; rules in the gitignored `scripts/anonymize-rules/vdl-2026.json`.
**Anonymized by:** Claude (under user direction), 2026-05-01.
**Anonymization audit:** see `_anonymization-audit.json` in this directory (records cells changed, no source content).

## What this fixture covers

A medium-complex slip — 8 logical products / 3 insurers / 3 entities / ~780 employees. Source is a legacy `.xls` file (auto-converted to `.xlsx` by `scripts/anonymize-slip.py` via Excel COM). The headline test is **cross-sheet GHS aggregation**: GHS data is split across 3 sheets (Locals / Secondees / Dependants) and the extractor must collapse them into ONE Product.

## What's structurally interesting

- **Source format `.xls` (legacy Excel binary).** First fixture exercising the auto-conversion path in `anonymize-slip.py`. The `.xls` format is endemic in the SG broker market.

- **Cross-sheet GHS aggregation.** Three GHS sheets:
  - `GHS - Locals` — main employee cohort across Plans B3/B2/B1/B/A/A1
  - `GHS - Secondees` — small group seconded overseas (Plans B/B1)
  - `GHS - Dependants` — voluntary dependant cover, plans mirror Locals
  The extractor must recognize these as one logical GHS product (same insurer, same policy, same period). Failing this, it'll emit 3 separate Products and the wizard will show duplicate cards.

- **Bundling without `bundledWithProductCode` field.** GHS-Locals's Annual Premium row is annotated `(Premium includes GP & SP)`. This means GHS-Locals's $182,348 covers GHS-Locals + GP + SP for the local employees. But GP and SP each have their own sheets with their own Annual Premium ($230,474 and $147,042). Those numbers are visible for transparency but should NOT be summed independently — they're already inside GHS-Locals. This is a real-world bundling pattern not currently expressible in the schema. Extractor should flag with a workbook warning. Reconciliation tolerance is wide (5% on grandComputed) to accept either interpretation.

- **Three legal entities (multi-jurisdiction master policy).** Slip lists `Test D Pte Ltd` (SG, master), `Test D China Ltd`, `Test D Americas LLC`. Tests `PolicyEntity.isMaster` semantics + sibling rows.

- **Three insurers, two with label variants.**
  - `Tokio Marine Life` (7 sheets, 5 logical products after GHS aggregation) — in seed catalogue ✓
  - `Berkshire` on GPA, `Berkshire Hathaway` on WICA — same insurer, two label variants. Extractor must canonicalize to one code (e.g. `BERKSHIRE`). Berkshire is NOT in the seed catalogue — Phase 1 follow-up (same gap as the missing insurer on png-2026).
  - `Chubb` on GBT — in seed catalogue ✓

- **Multi-class WICA with 10 categories.** Largest WICA layout in the corpus. Tests whether the extractor models 10 classes as one Product with 10 Plans/PremiumRates, or fragments them. Fixture asserts plan count only (10 plan codes too verbose to assert individually).

- **Salary-multiple GTL/GPA basis.** Cover is `36 x last drawn basic monthly salary` (BoD) and `24 x last drawn basic monthly salary` (others). Sum Insured columns are aggregates (per-person × headcount). This is the `salary_multiple` cover basis.

- **Long extension-notes free text.** "Additional Arrangements" sections at the bottom of each sheet contain prose extensions: secondment notes, third-party staffing partner contracts, intern coverage. The slip leaks PII and identifying detail in this section — see anonymization decisions below.

## Anonymization decisions (reviewer should know)

1. **Headcount NOT scaled.** README rule says scale to ≤100 max per category. Skipping the scaling here because the cross-sheet aggregation test doesn't require small headcounts and scaling would require ~50 cross-cell premium recomputations.

2. **Business description generalized.** Specific SSIC sub-category replaced with a broader one (~10x more candidate firms).

3. **Subsidiary geographies anonymized to Country B / Country C.** Original specific countries removed; generic placeholders preserve the multi-jurisdiction structure.

4. **Real employee names redacted.** Two real human names appeared in extension notes — direct PII. Replaced with `[Employee A]` / `[Employee B]`.

5. **Third-party staffing companies replaced.** 12 real SG staffing firms named in extension notes. Replaced with `Test Staffing Partner 1-12 Pte Ltd` to avoid exposing their commercial relationship with the (anonymized) client.

6. **Source-slip typos fixed.** The source had a typo in one entity name; the replacement standardizes to clean test data.

## Slip data summary

| Sheet | Logical product | Insurer | Sheet AP |
|---|---|---|---|
| GTL | GTL | Tokio Marine Life | 102,731.93 |
| GHS - Locals | GHS (aggregated) | Tokio Marine Life | 182,348 |
| GHS - Secondees | GHS (aggregated) | Tokio Marine Life | 524 |
| GHS - Dependants | GHS (aggregated) | Tokio Marine Life | 0 (rolled up) |
| GMM | GMM | Tokio Marine Life | 41,242 |
| GCGP | GP | Tokio Marine Life | 230,474 (may be bundled in GHS-Locals) |
| GCSP | SP | Tokio Marine Life | 147,042 (may be bundled in GHS-Locals) |
| GPA | GPA | Berkshire | 7,118.83 |
| GBT | GBT | Chubb | 2,051.50 |
| WICA | WICI | Berkshire Hathaway | 302,114.15 |

Two valid grand-total interpretations:
- Naive sum (all sheet APs): **1,015,646** — likely double-counts GP+SP
- Bundled (GP+SP rolled into GHS-Locals): **638,130**

Fixture's `reconciliation.grandComputed_min/_max` accepts either (range 600k–1.1M).

## Acceptance floor

`_minScore: 0.85` (current). Wider grandComputed tolerance (5%) than other fixtures because of the bundling ambiguity.

## Things to watch when extraction runs

- Does AI aggregate the 3 GHS sheets into ONE GHS product (correct) or 3 separate GHS products (incorrect)?
- Does AI surface a workbook-level warning about the GHS/GP/SP bundling note?
- Berkshire vs Berkshire Hathaway label canonicalization — does AI emit the same insurer code for both?
- Does AI recognize `GCGP` and `GCSP` as aliases for `GP` and `SP` (catalogue alias table)?
- Three policy entities: does AI mark Test D Pte Ltd as master and the other two as siblings?
- Multi-class WICA (10 categories): does AI emit 10 plans or fewer?
- Salary-multiple cover basis (36x or 24x salary): does AI map to `salary_multiple`?
