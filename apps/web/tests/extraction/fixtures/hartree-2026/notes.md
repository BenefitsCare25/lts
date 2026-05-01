# hartree-2026

**Source:** Anonymized from a real placement slip dated 2026-2027. Original identifiers replaced; rules in the gitignored `scripts/anonymize-rules/hartree-2026.json`.
**Anonymized by:** Claude (under user direction), 2026-05-01.
**Anonymization audit:** see `_anonymization-audit.json` in this directory (records cells changed, no source content).

## What this fixture covers

8 products / 3 insurers / 2 entities. Smaller than vdl-2026 but introduces several **firsts** in the corpus:

- **First fixture with a non-null `pool`** (`Insurope Pool`) — exercises pool extraction, attached at the policy level not per-product.
- **First fixture with a `#VALUE!` formula error** in source (WICA Annual Premium) — real-world data quality test.
- **First fixture with HSBC Life and Income Insurance** — both missing from seed catalogue (Phase 1 follow-up).
- **First fixture stressing 16k-col sheets** (Dental: 16135 cols, WICA: 16136 cols) — Excel cruft from sloppy templates; tests workbook-to-text serialization.
- **Free-text employee-exclusion section in GTL Additional Arrangements (rows B56-B69)** — slip lists per-employee insurance exclusions, special rates, and overseas secondments. All real names + masked NRICs in the source were replaced with `[Employee N]` and `[NRIC]` placeholders. Structure preserved so the extractor can still parse the exclusion patterns.

## What's structurally interesting

- **Pool only on GTL + GCI sheets.** The other 4 HSBC products (GHS/GP/SP/Dental) have blank `Pool` fields. Insurope Pool is HSBC's reinsurance pooling arrangement for life products specifically. Extractor must NOT propagate the pool to non-life products.

- **GCI = "Additional from Group Term Life".** GCI sheet title literally says it's an add-on to GTL. Whether the extractor treats this as `bundledWithProductCode='GTL'` (correct) or as a standalone product (functional but loses the relationship) is an open question. Phase 1 introduces the field; for now the fixture accepts either via per-product `status: ["OK", "BUNDLED"]`.

- **WICA `#VALUE!` formula error.** Annual Premium cell C32 contains `#VALUE!` instead of a number. The source slip's broker forgot to fix a broken formula. Real production data WILL contain this — extractor must:
  1. Not crash
  2. Surface as a workbook warning containing `#value`
  3. Allow the broker to manually enter the figure during review
  4. Accept null `declaredPremium` on the WICA product record

- **Dental + WICA 16k-col sheets.** Dental has 16135 columns, WICA has 16136 — almost certainly Excel cruft from a corrupted template or a stray formula reference. The extractor's workbook-to-text pass must bound iteration to populated cells, not loop the full max-col range. If it doesn't, prompt size explodes and Anthropic API rejects the call. The fixture's `expectedWarnings: ["16135"]` and `["16136"]` test that the extractor either handles silently or surfaces a warning about the unusual structure.

- **Three insurers across three different policy structures:**
  - HSBC Life Insurance (6 products, Insurope Pool, single shared policy number across GTL/GCI/GHS/GP/SP/Dental)
  - Zurich Insurance Company Ltd (GBT only, no policy number on slip)
  - Income Insurance Limited (WICA only, no policy number on slip)

- **Group Parent Protection extension on GBT.** B177 endorsement extends the GBT policy to cover 7 employees in `Test E Japan K.K.` (the Japan affiliate). Tests whether AI surfaces the multi-jurisdiction extension as a workbook warning.

- **Two address variants (#20-02 and #18-02).** Same building, different units. Most sheets use #20-02; WICA sheet uses #18-02. May represent two operating locations — preserved as separate strings in the fixture.

- **Three different business descriptions across sheets** (parent vs subsidiary vs operating activity) — generalized to broader SSIC categories in the anonymized fixture.

## Anonymization decisions (reviewer should know)

1. **Employee names + masked NRICs in GTL Additional Arrangements section redacted.** Anonymizer preserves the slip's structural patterns (`Insured Member, [Employee N] ([NRIC]), is excluded under this Policy for ...`) so the extractor can still parse them as exclusion rules. Medical conditions kept as-is (not PII once name+NRIC are gone).

2. **UEN replaced with placeholder UEN.** The slip's WICA sheet leaks a real SG company registration ID. Standard SG UEN format preserved in the placeholder.

3. **Foreign affiliate name redacted but country reference kept.** The "Japanese" employee references in GBT B177 are kept (generic — many SG firms employ Japanese nationals); the affiliate's identity is the part that's anonymized.

4. **Insurope Pool name kept.** It's a real reinsurance pool name, not identifying. Same as keeping insurer names like Tokio Marine, HSBC, Zurich.

5. **Catch-all bare entity-name replacements.** Run LAST (after longer phrase replacements) to catch any leftover bare references.

## Slip data summary

| Sheet | Product code | Insurer | Pool | Sheet AP |
|---|---|---|---|---|
| GTL | GTL | HSBC Life | Insurope | 59,777.65 |
| GCI | GCI | HSBC Life | Insurope | 56,370.52 |
| GHS | GHS | HSBC Life | (none) | 21,270 |
| GP | GP | HSBC Life | (none) | 3,234 |
| SP | SP | HSBC Life | (none) | 5,096 |
| Dental | Dental | HSBC Life | (none) | 2,408 (16135-col stress sheet) |
| GBT | GBT | Zurich | (none) | 1,640 (foreign-affiliate extension) |
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
- Does AI surface the GBT foreign-affiliate extension as a workbook warning?
- Two-entity master policy: does AI mark Test E Pte Ltd as master and Test E Energy as sibling?
- Does AI canonicalize `Zurich Insurance Company Ltd` to the seed catalogue's `ZURICH` code?
