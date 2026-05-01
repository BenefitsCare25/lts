# hartree-2026

**Source:** Anonymized from [REDACTED] + [REDACTED] real placement slip dated 2026-2027.
**Anonymized by:** Claude (under user direction), 2026-05-01.
**Anonymization audit:** see `_anonymization-audit.json` in this directory.

## What this fixture covers

8 products / 3 insurers / 2 entities. Smaller than [REDACTED] but introduces several **firsts** in the corpus:

- **First fixture with a non-null `pool`** (`Insurope Pool`) — exercises pool extraction, attached at the policy level not per-product.
- **First fixture with a `#VALUE!` formula error** in source (WICA Annual Premium) — real-world data quality test.
- **First fixture with HSBC Life and Income Insurance** — both missing from seed catalogue (Phase 1 follow-up).
- **First fixture stressing 16k-col sheets** (Dental: 16135 cols, WICA: 16136 cols) — Excel cruft from sloppy templates; tests workbook-to-text serialization.
- **Most PII-heavy fixture so far** — 18 real employee names with masked NRICs and medical exclusions in GTL Additional Arrangements section. Stress-tested the anonymizer's name-redaction patterns.

## What's structurally interesting

- **Pool only on GTL + GCI sheets.** The other 4 HSBC products (GHS/GP/SP/Dental) have blank `Pool` fields. Insurope Pool is HSBC's reinsurance pooling arrangement for life products specifically. Extractor must NOT propagate the pool to non-life products.

- **GCI = "Additional from Group Term Life".** GCI sheet title literally says it's an add-on to GTL. Whether the extractor treats this as `bundledWithProductCode='GTL'` (correct) or as a standalone product (functional but loses the relationship) is an open question. Phase 1 introduces the field; for now the fixture accepts either via per-product `status: ["OK", "BUNDLED"]`.

- **WICA `#VALUE!` formula error.** Annual Premium cell C32 contains `#VALUE!` instead of a number. The source slip's broker forgot to fix a broken formula. Real production data WILL contain this — extractor must:
  1. Not crash
  2. Surface as a workbook warning containing `#value`
  3. Allow the broker to manually enter the figure during review
  4. Accept null `declaredPremium` on the WICA product record

- **Dental + WICA 16k-col sheets.** Dental has 16135 columns, WICA has 16136 — almost certainly Excel cruft from a corrupted template or a stray formula reference. The extractor's workbook-to-text pass must bound iteration to populated cells, not loop the full max-col range. If it doesn't, prompt size explodes and Anthropic API rejects the call. The fixture's `expectedWarnings: ["16135"]` and `["16136"]` test that the extractor either handles silently or surfaces a warning about the unusual structure.

- **18 real employee names + 10 masked NRICs in GTL Additional Arrangements (rows B56-B69).** Members with sum-insured exclusions, medical condition restrictions, special rate overrides, and overseas secondment notes. All redacted to `[Employee 1]` … `[Employee 18]` and `[NRIC]`. The B68 special-rates block contains 10 rows of `<name> GDIB X sum assured @ Y` — preserved structurally so the extractor can still parse the rate table.

- **Three insurers across three different policy structures:**
  - HSBC Life Insurance (6 products, Insurope Pool, single policy `[REDACTED]` shared across GTL/GCI/GHS/GP/SP/Dental)
  - Zurich Insurance Company Ltd (GBT only, no policy number on slip)
  - Income Insurance Limited (WICA only, no policy number on slip)

- **Group Parent Protection extension on GBT.** B177 endorsement extends the GBT policy to cover 7 Japanese employees in Test E Japan K.K. (the Japan affiliate). Tests whether AI surfaces the multi-jurisdiction extension as a workbook warning.

- **Two address variants (#20-02 and #18-02).** Same building, different units. Most sheets use #20-02; WICA sheet uses #18-02. May or may not represent two real operating locations — anonymized as separate strings to preserve the variation.

- **Three different business descriptions across sheets:**
  - GTL/GCI: "[REDACTED]" ([REDACTED])
  - GHS/GP/SP/Dental/GBT: "[REDACTED]" ([REDACTED] HQ activities)
  - WICA: "[REDACTED]" ([REDACTED] operating activity)
  - All three generalized in the anonymized fixture: "Wholesale of fuels", "Head office activities", "Energy products and services"

## Anonymization decisions (reviewer should know)

1. **18 employee names + 10 NRICs redacted.** All in GTL rows B56-B69. The anonymizer preserves the slip's structural patterns (`Insured Member, [Employee N] ([NRIC]), is excluded under this Policy for ...`) so the extractor can still parse them as exclusion rules. Medical conditions kept as-is (not PII once name+NRIC are gone).

2. **UEN `[REDACTED]` → `T26TST0001A`.** The slip's WICA sheet leaks [REDACTED] UEN in B20/B28 cells. Standard SG UEN format preserved.

3. **Japan affiliate name redacted but country reference kept.** `[REDACTED]` → `Test E Japan K.K.` The "Japanese" employee references in GBT B177 are kept (generic — many SG firms employ Japanese nationals); the affiliate's identity is the part that's anonymized.

4. **Insurope Pool name kept.** It's a real reinsurance pool name, not identifying. Same as keeping insurer names like Tokio Marine, HSBC, Zurich.

5. **Catch-all bare `[REDACTED]` and `CHC` replacements.** Run LAST (after longer phrase replacements) to catch any leftover bare references.

## Slip data summary

| Sheet | Product code | Insurer | Pool | Sheet AP |
|---|---|---|---|---|
| GTL | GTL | HSBC Life | Insurope | 59,777.65 |
| GCI | GCI | HSBC Life | Insurope | 56,370.52 |
| GHS | GHS | HSBC Life | (none) | 21,270 |
| GP | GP | HSBC Life | (none) | 3,234 |
| SP | SP | HSBC Life | (none) | 5,096 |
| Dental | Dental | HSBC Life | (none) | 2,408 (16135-col stress sheet) |
| GBT | GBT | Zurich | (none) | 1,640 (Japan affiliate extension) |
| WICA | WICI | Income Insurance | (none) | **#VALUE!** (formula error in source) (16136-col stress sheet) |

Grand declared (excluding WICA): **149,796.17**.

## Acceptance floor

`_minScore: 0.85` (current). Grand-computed range allows 145k–200k to absorb GCI/GTL bundling ambiguity + the missing WICA figure.

## Things to watch when extraction runs

- Does AI attach `Insurope Pool` to the policy (correct) or to GTL/GCI products only (wrong shape)?
- Does AI flag `HSBC Life Insurance` and `Income Insurance Limited` as unknown insurers (not in seed catalogue)?
- Does AI handle the WICA `#VALUE!` cell without crashing? Surfaces as warning?
- Does the workbook-to-text pass bound iteration to populated cells on the 16k-col Dental + WICA sheets, OR does it serialize all 16k empty cells (prompt explosion)?
- Does AI recognize GCI as a top-up to GTL (`bundledWithProductCode='GTL'`)?
- Does AI surface the GBT Japan-affiliate extension as a workbook warning?
- Two-entity master policy: does AI mark Test E Pte Ltd as master and Test E Energy as sibling?
- Does AI canonicalize `Zurich Insurance Company Ltd` to the seed catalogue's `ZURICH` code?
