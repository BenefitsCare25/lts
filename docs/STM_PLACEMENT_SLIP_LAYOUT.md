# STM placement slip layout reference

Schema for `STMicroelectronics - Placement Slips 2026_workingfile.xls` — the canonical reference for the v2 §9 STM acceptance scenario (7 products, 6 benefit groups, 3 PolicyEntities).

Used by Phase 1G calibration (`prisma/seeds/product-catalogue.ts` parsing rules) and by Phase 2A architectural items below.

## File-level facts

- **Format**: `.xls` (legacy Excel binary; `xlrd` reads it, `exceljs` does not — see Phase 2 item "xls support").
- **Sheets**: 10 total — 1 billing summary, 1 comments/entities, 1 setup, 7 product sheets across 4 insurers.
- **Client**: STMicroelectronics group.
- **Period of insurance**: 01/01/2026 – 31/12/2026.

## Sheets

| # | Sheet name | Role |
|---|---|---|
| 0 | `Billing numbers` | Master billing summary (3 GE products consolidated). Not the source of truth for individual products — sheets 3-9 are. |
| 1 | `comments` | Free-text exclusions/notes per product type **and the 3 PolicyEntity entries** (rows 21–23). |
| 2 | `Setup` | Internal setup metadata (Hay Job Grade list, Flex tier permutations). Not parsed. |
| 3 | `GEL-GTL` | Great Eastern — Group Term Life. 4 plans (A/B/C/D); C and D stack on B and A respectively. |
| 4 | `GEL-GHS` | Great Eastern — Group Hospital & Surgical. 6 plans (1–6); 4/5/6 are Foreign Worker variants. |
| 5 | `GEL-GMM` | Great Eastern — Group Major Medical. 3 plans (1–3). |
| 6 | `GEL-SP` | Great Eastern — Specialist (Outpatient). 3 plans (1–3). |
| 7 | `Zurich-GPA` | Zurich — Group Personal Accident. 4 plans (A/B/C/D). |
| 8 | ` Chubb -GBT` | Chubb — Group Business Travel. 1 plan (note: leading space in sheet name). |
| 9 | `Allianz-WICI` | Allianz — Workplace Injury Compensation. Multi-entity rate tables (one per entity). |

## PolicyEntities (sheet 1, rows 21–23)

| Policy No. | Legal name | Master? |
|---|---|---|
| `G0005086` | STMICROELECTRONICS ASIA PACIFIC PTE LTD | yes |
| `G0005088` | STMICROELECTRONICS PTE LTD AMK | no |
| `G0005089` | STMICROELECTRONICS PTE LTD TPY | no |

These three policy numbers also appear comma-separated in `R11:C3` of every GE product sheet ("Policy No.: G0005086, G0005088, G0005089").

Zurich uses different per-entity policy numbers (`ZZG8000969SN / ZZG8000970SN / ZZG8000971SN` on sheet 7 R11). Chubb and Allianz are listed `TBA` in this draft.

## Common header (all 7 product sheets)

The four insurers' sheets share a consistent header. Coordinates use `R<row>:C<col>` (1-indexed). Cell `C3` is column 3 = "C" in spreadsheet notation.

| Field | GE sheets | Zurich | Chubb | Allianz |
|---|---|---|---|---|
| Product type label | R1:C1 | R1:C1 | R1:C1 | R1:C1 |
| Group | R3:C3 | R3:C3 | R3:C3 | R3:C4 |
| Policyholder (master entity) | R4:C3 | R4:C3 | R4:C3 | R4:C4 |
| Insured (entity CSV) | R5:C3 | R5:C3 | R5:C3 | R5:C4 |
| Office Address | R6:C3 | R6:C3 | R6:C3 | R6:C4 |
| Business / Industry | R7:C3 | R7:C3 | R7:C3 | R7:C4 |
| Period of Insurance | R8:C3 | R8:C3 | R8:C3 | R8:C4 |
| Insurer name | R9:C3 | R9:C3 | R9:C3 | R9:C4 |
| Pool | R10:C3 | R10:C3 | R10:C3 | — |
| Policy No. (CSV) | R11:C3 | R11:C3 | R11:C3 | R10:C4 |
| Eligibility | R13:C3 | R13:C3 | R13:C3 | R12:C4 |
| Eligibility Date | R14:C3 | R14:C3 | R14:C3 | R13:C4 |
| Last entry age | R15:C3 | R15:C3 | R15:C3 | R14:C4 |
| Type of Administration | R17:C3 | R17:C3 | R17:C3 | R16:C4 |

Allianz is the outlier: header runs one column right (`C4` instead of `C3`) and one row up from R12 onwards.

## Per-sheet plan + rate block layouts

### Sheet 3 — `GEL-GTL`

**Plan / Cover Basis block** (header at R20, body R21–R24):
- Cols: `B`=Insured | `D`=Plan name | `E`=Participation | `F`=No. of employees | `G`=Cover basis | `H`=Sum Insured

| Plan | Cover basis | Headcount | Sum Insured |
|---|---|---|---|
| Plan A: Hay Job Grade 16 and above | 36 × LDBMS | 352 | 176,110,444 |
| Plan B: Hay Job Grade 08 to 15 and Bargainable Staff | 24 × LDBMS | 4,381 | 426,049,316 |
| Plan C: Bargainable Staff who are Fire Fighters | 60 × LDBMS additional above Plan B | 145 | 19,500,840 |
| Plan D: Non-bargainable Staff who are Fire Fighters | 36 × LDBMS additional above Plan A | 156 | 45,420,648 |

**Rate block** (header at R28, body R29–R32):
- Cols: `D`=Plan | `E`=Sum Insured | `F`=Rate per S$1,000 | `G`=Annual Premium

Strategy: `per_individual_salary_multiple`. Rate is 0.90 per S$1,000 across all plans.

**Plan stacking** (per v2 acceptance test):
- Plan C `stacksOn` Plan B (text says "additional above Plan B")
- Plan D `stacksOn` Plan A (text says "additional above Plan A")

### Sheet 4 — `GEL-GHS`

**Plan / Cover Basis block** (header at R20, body R22–R27):
- Cols: `D`=Plan name | `G`=Participation | `I`=Plan number (1–6)

| Plan # | Plan name | FW |
|---|---|---|
| 1 | Hay Job Grade 18 and above + dependents | no |
| 2 | Hay Job Grade 08–10 / 11–17 + dependents | no |
| 3 | Bargainable Employees, Interns, Contract | no |
| 4 | FW WP/SP Hay Job Grade 18+ + dependents | yes |
| 5 | FW WP/SP Hay Job Grade 08–10 / 11–17 | yes |
| 6 | FW WP/SP Bargainable | yes |

**Rate block** (header at R30–R31, body R32–R37):
- Cols: `D`=Plan | `E`=EO Rate | `F`=EO Premium | `G`=ES Rate | `H`=ES Premium | `I`=EC Rate | (continues for ES/EC/EF in subsequent columns)
- Strategy: `per_group_cover_tier` (rate per cover tier × headcount).
- Cover tiers per plan: EO (employee only), ES (employee + spouse), EC (employee + children), EF (employee + family).

### Sheet 5 — `GEL-GMM`

Same structure as GHS but 3 plans (1–3 only). Plan/cover-basis at R22–R24. Rate at R30–R32. Strategy: `per_group_cover_tier`.

### Sheet 6 — `GEL-SP`

Same structure as GHS but 3 plans. Plan/cover-basis at R21–R23. Strategy: `per_group_cover_tier`.

### Sheet 7 — `Zurich-GPA`

Plan / Cover basis at R20–R23 (4 plans A/B/C/D). Rate at R28–R31. Strategy: `per_individual_salary_multiple` for Plans A/B (LDBMS-based), `per_individual_fixed_sum` for Plans C/D.

### Sheet 8 — ` Chubb -GBT` (note leading space)

Single plan covering all employees on business trips. Plan at R21, Rate at R25. Strategy: `per_headcount_flat`.

### Sheet 9 — `Allianz-WICI`

Multi-entity rate tables: one per PolicyEntity. Sheet contains separate Basis-of-Cover and Rate tables for each entity (R20–R25 for Asia Pacific, R27–R29 for AMK, etc.). Strategy: `per_individual_earnings`.

## Benefit groups (derived, not directly tabulated)

The 6 benefit groups (4 compound) for the v2 acceptance test are inferred from the GHS plan eligibility text (sheet 4, rows 22–27). Compound predicates emerge from the plans that combine job grade ranges, work pass type, and bargainable status.

Proposed JSONLogic predicates (subject to refinement during S31 work):

| Group | Predicate (informal) | Compound? |
|---|---|---|
| Senior Mgmt + dependents | `employee.hay_job_grade >= 18` | no |
| Corporate Staff + dependents | `8 <= employee.hay_job_grade <= 17` | no (range) |
| Bargainable / Interns / Contract | `employee.bargainable == true` | no |
| FW WP/SP Senior | `(work_pass_type IN [WP, SP]) && (hay_job_grade >= 18)` | yes |
| FW WP/SP Corporate | `(work_pass_type IN [WP, SP]) && (8 <= hay_job_grade <= 17)` | yes |
| FW WP/SP Bargainable | `(work_pass_type IN [WP, SP]) && (bargainable == true)` | yes |

The 4 "compound" groups are the FW Senior/Corporate/Bargainable trio plus the Corporate range predicate.

## Architectural items surfaced

These are gaps between what the existing parser handles and what STM-style slips require. Each becomes a Phase 2 (or 2A) item.

### 1. Multi-insurer slip dispatch

**Today**: `placementSlips.upload` classifies a workbook as belonging to one insurer template (`ProductType.parsingRules.templates[insurer]`). One slip → one insurer's products.

**Reality**: STM's slip mixes 4 insurers (Great Eastern, Zurich, Chubb, Allianz) across 7 sheets. Real broker workflow consolidates renewals across insurers in one document.

**Proposed design**: per-sheet insurer dispatch — extract insurer from sheet name prefix (`GEL-`, `Zurich-`, `Chubb-`, `Allianz-`) or the `R9:C3` "Insurer :" cell, then route each sheet to that insurer's product-type-specific parsing rules. One upload → many Products spanning insurers.

### 2. `.xls` support

**Today**: parser uses `exceljs` which is `.xlsx` only. The placement-slips upload route runs a magic-byte sniff (`PK\x03\x04`) and rejects `.xls`.

**Reality**: insurer/broker tooling commonly outputs legacy `.xls` (the STM file is one). Python's `xlrd` reads it; SheetJS / `xlsx` is the JS equivalent.

**Proposed design**: route the buffer through SheetJS for `.xls`, exceljs for `.xlsx`. Or convert at upload time. Replacing exceljs entirely with SheetJS is also viable.

### 3. Parsing rules need per-product calibration with real coordinates

Today the seeded `parsingRules` in `prisma/seeds/product-catalogue.ts` are placeholders. This document is the source of truth for calibrating them — once per (insurer × product) pair.

The header layout is identical across GE products and very similar across Zurich/Chubb/Allianz, so the bulk of the work is encoding the per-sheet plan-and-rate-block coordinates documented above.

## Open questions

- **Pool**: GE products list "Generali Pool - Captive". Zurich/Chubb/Allianz say "NA". The `Pool` registry in our schema is per-tenant — confirm with broker that this represents a tenant-level pool entity, not a per-policy attribute.
- **TBA values**: Chubb sheet shows `Policy No.: TBA` and `*Total No. of employees per policy year: TBA`. The parser must tolerate placeholder text and surface it as a resolvable issue (S32) rather than failing.
- **Allianz multi-entity rate tables**: the parser needs to read multiple rate blocks per sheet (one per entity). Does the existing `parsingRules.rate_block` schema support an array of blocks, or just one? Likely needs extension.
- **GBT cover schedule**: the slip text says "Pending Chubb's update on Trip Patterns" — schedule of benefits will arrive in a separate sheet/file later. Phase 1H/2 territory.
