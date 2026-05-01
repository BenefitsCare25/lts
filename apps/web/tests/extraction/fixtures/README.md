# Extraction fixture corpus

Each subdirectory is one anonymized real-world placement slip plus its golden expected output. The regression test (`../regression.test.ts`) runs the extractor against every fixture and emits a per-fixture + grand-total accuracy delta on every PR.

This is **the empirical truth** for "is extraction accurate?" — opinions don't ship; fixture deltas do.

---

## Coverage matrix (working set)

5 fixtures chosen for *coverage* of slip-shape patterns, not volume. Add more as real broker uploads surface novel edge cases.

| # | Fixture | Coverage |
|---|---|---|
| 1 | `stmicro-2026/` | **Stress case** — 7 products across 4 insurers, 3 master-policy entities, flex bundles, broker comments sheet, billing-numbers sheet, multi-parent plan stacking. The hardest slip in the set. (Pending — fixture not yet built.) |
| 2 | `cbre-mcst-2026/` | **Simple baseline** — 5 products, single entity, single insurer. Two address fields (ACRA + Mailing). Two-year-billed-annually period. If extraction can't get this, nothing else matters. |
| 3 | `vdl-2026/` | **Cross-sheet aggregation** — GHS split into 3 sheets (Locals / Secondees / Dependants). Tests whether the runner collapses them into one Product or emits three. Multi-jurisdiction master policy (3 entities). 778-employee scale. Bundling note "(Premium includes GP & SP)". |
| 4 | `png-2026/` | **Workbook-level summary sheet** — declared totals come from a separate sheet, not the product page. Min-premium clause on WICA. Per-product summary/sheet declared mismatch on GPA. Two-insurer policy. |
| 5 | `hartree-2026/` | **Pool + edge cases** — first non-null `pool` (`Insurope Pool`). `#VALUE!` formula error in WICA Annual Premium. 16k-col stress sheets (Dental, WICA). HSBC Life + Income Insurance not in seed catalogue. GCI as add-on to GTL. Multi-jurisdiction GBT extension. |

When adding a new slip, document the *why* — what slip-shape pattern does it cover that the current set doesn't?

---

## Directory shape (per fixture)

```
fixtures/
  <fixture-name>/
    slip.xls              # the anonymized .xls (or .xlsx)
    expected.json         # golden output the extractor must produce
    ai-responses.json     # recorded AI mock for replay (no real Anthropic in CI)
    notes.md              # what's tricky about this slip; anonymization audit log
```

`expected.json` is checked against the extractor's actual output with per-field tolerance (see `../compare-to-expected.ts`). `ai-responses.json` is replayed when `EXTRACTION_RECORD_AI` is unset (default in CI).

---

## Anonymization rules

Real slips MUST be anonymized before the slip file enters this directory. Anyone reviewing a PR will look at the slip cells.

| Field | Replace with |
|---|---|
| Policyholder legal name | `Test <Letter> Pte Ltd` (sequential per fixture: A, B, C, …) |
| Insured entity names | Same root, with optional facility suffix (e.g. `Test A Pte Ltd HQ`, `Test A Pte Ltd Plant 1`) |
| UEN | `199900<NNN>X` where NNN unique per fixture |
| Address — full | A fictional Singapore postal address (use street names from the public OneMap test set) |
| Business description | Keep the SSIC category but generalize (e.g. "Manufacture of printed circuit boards" → "Manufacture of electronic components") |
| Contact name / email | Drop entirely (set to null) |
| Headcount per category | **Keep proportions, scale max to ≤ 100** per category. Premium math integrity preserved (multiplier × headcount × rate sums proportionally). |
| Sum Insured (per category) | Scale proportionally with headcount |
| Premium rates (per S$1,000 etc.) | **KEEP EXACT** — rates don't disclose identity |
| Annual Premium (per product, declared) | Scale proportionally so it still ≈ headcount × SI × rate / 1000 |
| Policy number | `TEST/<insurer>/<NNN>` |

**Why scale headcounts:** real corporate headcounts are PII-ish (combined with industry context can identify the firm). Scaling preserves the math integrity (so reconciliation tests still validate computed-vs-declared) without identification risk.

**Privacy review gate:** every fixture PR must be reviewed by a team lead before merge. Add `CODEOWNERS` rule once team grows past one person.

---

## Adding a new fixture (process)

> **Lessons from earlier fixtures — read before starting** (each one bit us once):
> - **Scan free-text sections, not just headers.** "Additional Arrangements" / "Schedule of Benefits" / extension-notes paragraphs at the bottom of product sheets often leak the most: real employee names, third-party staffing partners, foreign affiliate locations. The structured fields (Policyholder, Address, Policy No.) are the easy 80% — the prose is where the PII hides. Use a comprehensive substring sentinel scan across EVERY cell of EVERY sheet, including any abbreviations or alternate spellings of identifiers.
> - **`.xls` sources auto-convert.** `scripts/anonymize-slip.py` invokes Excel COM if the source ends in `.xls`. No manual conversion step needed.
> - **Numeric policy IDs need `cell_overrides`, not `replace_strings`.** The string-replace pass skips non-string cells. If a policy number is stored as an integer rather than a string, use a per-cell override.
> - **Formula refs propagate cached values past `cell_overrides`.** If you override `H32` but `F37` is `=H32`, the flatten step writes the OLD cached value to F37 before your override runs. Override both.
> - **Pseudonyms can self-leak.** Avoid abbreviations in placeholder strings that decode back to the source. Use neutral patterns like `TEST/<insurer>/2026-NNN`.

1. Get the original .xls from the broker (with consent or under existing data-handling agreement).
2. Open in Excel (or via the `scripts/anonymize-slip.py` helper). Apply the rules above.
3. Save as `slip.xls` in a new `fixtures/<name>/` directory.
4. Run the extractor in record mode:
   ```
   EXTRACTION_RECORD_AI=true \
     pnpm --filter web test -- tests/extraction/regression.test.ts -t '<fixture-name>'
   ```
   This calls real Anthropic and writes `ai-responses.json`. Cost: $0.50–$2 per slip. (BYOK: comes out of the tenant's AI Foundry budget.)
5. Hand-verify the AI's output against the slip. Build `expected.json` from the verified envelope (with tolerances, `_required` markers, expected warnings).
6. Re-run replay (default — no API calls):
   ```
   pnpm --filter web test -- tests/extraction/regression.test.ts -t '<fixture-name>'
   ```
   Should pass with score ≥ 0.85.
7. Write `notes.md` (template below).
8. Commit. CI now runs the new fixture on every PR.

---

## Per-fixture `notes.md` template

```md
# <fixture-name>

**Source:** Anonymized from <broker>'s real slip dated <yyyy-mm>.
**Anonymized by:** <name>, <date>.
**Anonymization audit:** all 9 categories above checked; PR review by <lead> on <date>.

## What's tricky

- ...

## Expected gotchas

- ...

## Acceptance floor

`expected._minScore: 0.85`
```

---

## Slip files NOT in this directory

The user keeps un-anonymized originals at `C:\Users\huien\Desktop\slips\` (gitignored at user-level). Never copy raw originals into `apps/web/tests/extraction/fixtures/` — they'll get committed and PR-reviewed (PDPA exposure). The `.gitignore` in this directory blocks `_originals/` and any file with `_original` in the name as a backstop.
