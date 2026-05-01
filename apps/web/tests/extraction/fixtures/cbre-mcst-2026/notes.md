# cbre-mcst-2026

**Source:** Anonymized from [REDACTED] [REDACTED]'s real placement slip dated 2025-2026.
**Anonymized by:** Claude (under user direction), 2026-05-01.
**Anonymization audit:** see `_anonymization-audit.json` in this directory.

## What this fixture covers

The simplest slip in the working corpus. **5 products, 1 entity, 2 insurers, 12-14 employees total.** Single-tenant, single-master-policy. If the extractor can't get this slip right, nothing else matters.

## What's structurally interesting

- **Two address rows.** Row 6 = `ACRA Office Address`, row 7 = `Mailing Address`. They differ. Most slips have one address; this slip splits them. The discovery prompt should pick ACRA as `client.address` (the registered office) and either drop or surface the mailing address separately. Currently the audit doesn't detect a wizard slot for "mailing address," so dropping is acceptable.

- **Two-year contract billed annually.** Period of Insurance on GTL/GDD/GHS/GMM reads `01/07/2024 - 30/06/2026 (2 years rate but to bill annually)`. GPA's period is the current annual block: `01/07/2025 - 30/06/2026`. The wizard's `BenefitYear` is annual — AI should extract the current billing window (2025-07-01 → 2026-06-30), not the 2-year span. This is a real test of period-parsing intelligence.

- **GHS / GMM cover-tier rates are per-employee, not per-S$1,000-SI.** Slip header says `Rate per S$1,000 sum insured` for GTL/GDD/GPA but on GHS/GMM the column is just `Rate` and the math works out as `rate × headcount` (e.g. GHS: 282 × 12 = 3384). This is the WICI / "per_employee" basis case — Phase 1's schema redesign covers it. Until Phase 1 lands, expect `INCOMPLETE_SCHEDULE` on these two products in the reconciliation report (the schema can't represent the basis).

- **Single-tier extractions.** GHS has 4 cover tiers (EO/ES/EC/EF) but only EO is populated; ES/EC/EF cells are `NA`. Tests whether the extractor handles partial cover-tier rate tables gracefully.

- **`Product Rated Together: GTL, GDD, GHS, GMM`** appears in row 32-33 of the GE products. This indicates the four GE-Life products are jointly underwritten — relevant for renewal / claims but currently has no schema representation. Surface as a workbook-level warning at most.

- **`Policyholder(s) Rated Together: [REDACTED]`** — the original slip leaks the parent group name in this row. The anonymization replaces with `Test Group`. Per-fixture audit log records the rule.

## Slip data summary

| Product | Insurer | Headcount | SI per person | Total SI | Rate basis | Rate value | Annual Premium |
|---|---|---|---|---|---|---|---|
| GTL | Tokio Marine Life | 12 | 80,000 | 960,000 | per S$1,000 SI | 1.26 | 1,209.60 |
| GDD | Tokio Marine Life | 12 | 40,000 | 480,000 | per S$1,000 SI | 1.46 | 700.80 |
| GHS (Plan 8) | Tokio Marine Life | 12 (all EO) | n/a | n/a | per employee | 282/EO | 3,384.00 |
| GMM (Plan 8) | Tokio Marine Life | 12 (all EO) | n/a | n/a | per employee | 83/EO | 996.00 |
| GPA | Zurich | 14 | 100,000 | 1,400,000 | per S$1,000 SI | 0.075 | 105.00 |
| **TOTAL** | | | | | | | **6,395.40** |

## Acceptance floor

`_minScore: 0.85` (current). Raise to 0.92 once the extractor integration in `regression.test.ts` lands and we have a real baseline accuracy number.

## Things to watch when extraction runs

- Does AI pick the current annual benefit year (2025-07-01 → 2026-06-30)?
- Does AI surface a workbook-level warning about the two address fields?
- Does AI correctly classify GHS/GMM as `per_employee_flat` once Phase 1 schema lands? (Pre-Phase-1 it'll be `per_cover_tier` with empty schedule, status `INCOMPLETE_SCHEDULE`.)
- Insurer code mapping: the AI returned `TM_LIFE`-style codes for [REDACTED]'s GE-Life products. For Tokio Marine Life the canonical code should also follow the registry. Verify after Phase 2 V-7 fix lands.
