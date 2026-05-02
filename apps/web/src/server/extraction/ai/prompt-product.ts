// =============================================================
// Per-product extraction user prompt builder.
//
// Stage 2 of the map-reduce: the model is given the full workbook
// text plus a manifest entry pinpointing which (productTypeCode,
// insurerCode) to extract, plus the heuristic baseline for that
// product as a starter.
//
// Why pass the full workbook (not just the anchor sheets): premium
// rate context sometimes lives on a sister sheet (e.g. "Common
// Rates" referenced by GHS, GTL, GPA simultaneously). Truncating to
// anchor-sheets-only risks missing that context. Prompt caching
// makes the workbook bytes cheap on calls 2..N+1 anyway.
//
// Heuristic baseline as anchor: confidence-1.0 cells the parser
// already located (policy number, period, currency, plan labels)
// are emitted up front so the model doesn't waste output tokens
// re-extracting them. The model is instructed to override only on
// strong evidence.
// =============================================================

import type { ExtractedProduct } from '@/server/extraction/heuristic-to-envelope';
import type { ProductManifestEntry } from './schema-discovery';

export function buildProductUserPrompt(
  workbookText: string,
  manifest: ProductManifestEntry,
  heuristicProduct: ExtractedProduct | null,
  retryHint: string | undefined,
): string {
  const retryBlock = retryHint
    ? [
        '',
        '## Retry — your previous output for this product failed schema validation',
        '',
        'Fix the following issues and re-emit the FULL ExtractedProduct envelope:',
        '```',
        retryHint,
        '```',
        '',
      ]
    : [];

  const heuristicBlock = heuristicProduct
    ? [
        '## Heuristic baseline (high-confidence cells already located)',
        '',
        'The deterministic parser already located these cells at confidence 1.0. Use them as',
        'anchors and only override if the workbook clearly contradicts. You DO need to re-emit',
        'them in the envelope (the runner does not splice them in for you).',
        '',
        renderHeuristicSummary(heuristicProduct),
        '',
      ]
    : [
        '## Heuristic baseline',
        '',
        '(No heuristic match for this product — extract from the workbook from scratch.)',
        '',
      ];

  const anchorBlock =
    manifest.anchorSheets.length > 0
      ? [
          '## Anchor sheets',
          '',
          `Primary data for this product is on: ${manifest.anchorSheets.map((s) => `\`${s}\``).join(', ')}.`,
          'Other sheets may carry shared context (rates, common eligibility) — use them when relevant.',
          '',
        ]
      : [];

  const notesBlock = manifest.notes ? ['## Discovery notes', '', manifest.notes, ''] : [];

  return [
    'You are running a PER-PRODUCT extraction pass. Extract ONE product from the workbook:',
    '',
    `- productTypeCode: **${manifest.productTypeCode}**`,
    `- insurerCode:    **${manifest.insurerCode}**`,
    '',
    'Return one ExtractedProduct envelope matching the tool input schema. Every field uses the',
    '`{ value, raw, confidence, sourceRef }` shape. Cite source cells using the A1 references',
    'as they appear in the workbook serialization (e.g. `B12`). Use null + confidence 0 when',
    'the workbook does not contain a value — never fabricate.',
    '',
    '## Plan extraction rules',
    '',
    'Plans are distinct coverage tiers within a product, typically labelled "Plan A", "Plan B1", etc.',
    'on the slip. **Do not confuse employee categories with plans.** If the Basis of Cover lists',
    'employee groups (e.g. "Board of Directors", "All Others") but has no "Plan" column with letter/',
    'number codes, the product has a **single implicit plan** — emit one plan with `rawCode: "1"`,',
    '`rawName: "Default"`, and the appropriate `coverBasis`. Each employee group becomes a category',
    'in `eligibility.categories`, not a separate plan.',
    '',
    'How to tell the difference:',
    '- **Explicit plans**: Basis of Cover table has a "Plan" column showing codes like A, A1, B, B1, B2.',
    '  Each code = one plan. Categories map to plans via `defaultPlanRawCode`.',
    '- **No plan codes**: Basis of Cover lists categories (populations) with SI formulas and rates',
    '  but no plan column. Emit one plan (`rawCode: "1"`, `rawName: "Default"`) and set every',
    '  category\'s `defaultPlanRawCode` to `"1"`. Rates are per-category, keyed to planRawCode `"1"`.',
    '',
    '**rawCode must always be the SHORT identifier** (e.g. "A", "B1", "1") — never the full category',
    'description, never a footnote, never multi-line text. Plan codes are typically 1-3 characters.',
    'Some slips label Basis of Cover rows as "Plan A: Hay Job Grade 16 and above":',
    '- `rawCode` = "A"  (the letter only)',
    '- `rawName` = "Plan A" or "A"  (the plan label as printed)',
    '- `eligibility.categories[]` gets an entry with `category = "Hay Job Grade 16 and above"`,',
    '  `defaultPlanRawCode = "A"`',
    '',
    '**Footnotes and annotations are NOT plan codes.** Cells sometimes contain multi-line text like:',
    '  `3\\n\\n* Bargainable employees is eligible for 4 Bed Govt/Restr. Hospital`',
    'The rawCode is `"3"`, not the entire multi-line string. Annotations (lines starting with `*`)',
    'are eligibility notes — place them in `eligibility.categories[].category` or ignore them.',
    '',
    '**Do NOT emit two plans for the same tier.** Common duplications to avoid:',
    '- `rawCode = "Plan A: Hay Job Grade 16 and above"` alongside `rawCode = "A"` — emit ONLY `"A"`.',
    '- `rawCode = "Hay Job Grade 18 and above and their Eligible Dependents"` alongside `rawCode = "1"`',
    '  — the first is a category description, NOT a plan. Emit ONLY the numbered plan.',
    '- `rawCode = "Non-Manual Employees earning above S$1,600 per month"` — this is a category, not a',
    '  plan. If the product has no explicit plan codes, emit one plan with `rawCode: "1"`.',
    'Each product must have EITHER short-code plans (A, B1, 1, 2) OR one default plan — never both',
    'short-code plans AND long-description plans.',
    '',
    'For every plan you emit:',
    '- Set `coverBasis` to one of: `per_cover_tier` | `salary_multiple` | `fixed_amount` |',
    '  `per_region` | `earnings_based` | `per_employee_flat`.',
    '- Populate `schedule` based on the basis:',
    '  - **salary_multiple**: extract the integer multiplier from the basis-of-cover formula.',
    '    Example: "36 x LDBMS" → `schedule.multiplier = 36`.',
    '  - **fixed_amount**: extract the sum assured.',
    '    Example: "$50,000" → `schedule.sumAssured = 50000`.',
    '  - **per_employee_flat**: extract the per-person rate.',
    '    Example: "$9.50 per insured person" → `schedule.ratePerEmployee = 9.5`.',
    '  - **per_cover_tier**: add `schedule.dailyRoomBoard` if the slip states a room-and-board',
    '    limit; leave `schedule` empty otherwise.',
    '  - **earnings_based** / **per_region**: leave `schedule` empty unless the slip gives a',
    '    specific rate figure.',
    '- For plan stacking ("additional above Plan X"), use `stacksOnRawCodes` (array):',
    '  - One parent: `stacksOnRawCodes = ["B"]`',
    '  - Two parents: `stacksOnRawCodes = ["A", "B"]`',
    '  - No stacking: `stacksOnRawCodes = []`',
    '  - **Do NOT** use the deprecated `stacksOnRawCode` (singular) field.',
    '',
    '## Premium rate extraction rules',
    '',
    '- Use `ratePerThousand` when the slip states a rate "per $1,000 sum assured" (e.g. "0.90 per $1,000 SI").',
    '- Use `fixedAmount` for:',
    '  - Cover-tier table entries (EO/ES/EC/EF annual premiums, e.g. $353 per year)',
    '  - Per-person flat rates — when a note says "per insured person", "per head", or "per person".',
    '    In this case also set the plan\'s `coverBasis: "per_employee_flat"` (not `"fixed_amount"`).',
    '    Example: "$9.50 per insured person" → plan.coverBasis = "per_employee_flat",',
    '    rate.fixedAmount = 9.5, rate.ratePerThousand = null.',
    '- Never emit both `ratePerThousand` and `fixedAmount` non-null on the same rate row.',
    '',
    '## Cover-tier rate tables (EO / ES / EC / EF)',
    '',
    'When the Rate section has columns for EO, ES, EC, EF (Employee Only, Employee + Spouse,',
    'Employee + Child, Employee + Family), extract one rate row per plan per non-zero column:',
    '- Set `coverTier` to the column header exactly as written: "EO", "ES", "EC", or "EF".',
    '- Set `planRawCode` to the plan code for that row (e.g. "1", "2", "A").',
    '- Set `fixedAmount` to the rate amount. Set `ratePerThousand` to null.',
    '- **OMIT any column where the rate is 0 or blank** — do not emit zero-rate rows.',
    '  Example: Plan 3 with EO=201, ES=0, EC=0, EF=0 → emit ONE row:',
    '  { planRawCode: "3", coverTier: "EO", fixedAmount: 201 }',
    '  Example: Plan 1 with EO=353, ES=0, EC=0, EF=1112 → emit TWO rows:',
    '  { planRawCode: "1", coverTier: "EO", fixedAmount: 353 }',
    '  { planRawCode: "1", coverTier: "EF", fixedAmount: 1112 }',
    '',
    '**IMPORTANT — the Basis of Cover table also has EO/ES/EC/EF columns, but those show',
    'headcounts (illustration figures), NOT rates.** Only extract rates from the "Rate:" section.',
    'The note "Only EO and EF under the policy" means ES and EC are not offered — omit them.',
    '',
    '## Eligibility category extraction rules',
    '',
    '- **eligibility.categories**: extract one row per employee category from the "Basis of Cover"',
    '  section. Each category row typically has: category label, participation, headcount, SI formula.',
    '- **defaultPlanRawCode**: set to the plan code (rawCode) assigned to this category on the slip.',
    '  Example: if "Board of Directors" maps to Plan B2, set `defaultPlanRawCode: "B2"`.',
    '  When the product has no explicit plan codes (single implicit plan), set `defaultPlanRawCode: "1"`',
    '  for every category.',
    '  This captures the category → plan mapping directly. Leave null only if the slip does not',
    '  show a plan assignment for this category.',
    '',
    '## Header extraction rules',
    '',
    '- **declaredPremium**: the "Annual Premium" cell on this product\'s sheet (one number per',
    '  product). Set `{ value: <number>, raw: <verbatim cell>, confidence: 0.95,',
    '  sourceRef: { sheet, cell } }`. Leave null when not stated.',
    '- **bundledWithProductCode**: set to the productTypeCode of the carrier product when this',
    "  product's premium is rolled into another product's rates (e.g. SP premium listed under",
    '  "Part of GHS"). Leave null when this product has its own declared premium.',
    '- **ageLimitNoUnderwriting**: the age at or below which new members are accepted without',
    '  medical underwriting. Look for cells labelled "Age Limit for No Underwriting",',
    '  "Non-Evidence Limit (Age)", "Non Evidence Limit", "NEL Age", "Free Cover Limit (age)",',
    '  or "Guaranteed Issue (age)". The cell value may be a compound sentence like',
    '  "Sum insured exceeding X or age N and above requires underwriting" — extract N as the',
    '  integer (N is the first age that REQUIRES underwriting, so the no-UW limit is N). Emit',
    '  as a NumberField integer. Leave null when not stated.',
    '- **aboveLastEntryAge**: how members above the last entry age are treated. Look for a cell',
    '  labelled "Above Last Entry Age", "Provisional", "Members above LEA", "Renewal beyond LEA".',
    '  Also check the eligibility text: if it contains a phrase like "renewable up to age X',
    '  next birthday" or "renewable up to age X", emit that phrase verbatim as the StringField',
    '  value (e.g. "Renewable up to age 75 next birthday"). Typical values: "Provisional basis",',
    '  "Excluded", "Renewable up to age 75 next birthday". Leave null when not stated.',
    '- **employeeAgeLimit**: maximum age an employee can remain covered. Look for dedicated cells',
    '  "Employee Age Limit", "Age Limit (Employee)", "Max Age – Employee", "Termination Age",',
    '  "Cease Age", "Expiry Age (Employee)", "Maximum Age". Also infer from the eligibility text:',
    '  if the text says "Below Age N" or "up to age N" or "employees below age N", emit N as the',
    '  integer. Example: eligibility "All Full Time … Below Age 67, renewable up to age 75"',
    '  → employeeAgeLimit: 67. NumberField.',
    '- **spouseAgeLimit**: maximum age for a covered spouse. Look for "Spouse Age Limit",',
    '  "Age Limit (Spouse)", "Max Age – Spouse", "Expiry Age (Spouse)", "Cease Age – Spouse".',
    '  Leave null when not stated. NumberField.',
    '- **childAgeLimit**: maximum age for a covered child. Look for "Child Age Limit",',
    '  "Age Limit (Child)", "Max Age – Child", "Expiry Age (Child)", "Cease Age – Child",',
    '  "Eligible up to age". Leave null when not stated. NumberField.',
    '- **childMinimumAge**: minimum age for a covered child (often 14 days or 1 month expressed',
    '  as 0). Look for "Child Minimum Age", "Min Age (Child)", "Minimum Age – Child", "Min Age".',
    '  If the slip states a number of days (e.g. "15 days"), emit 0. Leave null when not stated.',
    '  NumberField.',
    '',
    ...anchorBlock,
    ...notesBlock,
    ...heuristicBlock,
    ...retryBlock,
    '## Workbook',
    '',
    'Each populated cell is shown as `A1: value`. Empty cells omitted. Cells over 800 chars',
    'truncated with an ellipsis. Sheets separated by `---`.',
    '',
    workbookText,
    '',
    '## Now emit the product',
    '',
    `Call the \`emit_product\` tool exactly once with the full ExtractedProduct envelope for **${manifest.productTypeCode} × ${manifest.insurerCode}**. Other products on the slip`,
    'are handled by other passes — extract only this one.',
  ].join('\n');
}

function renderHeuristicSummary(p: ExtractedProduct): string {
  const lines: string[] = [];
  const env = (
    label: string,
    e: {
      value: unknown;
      confidence: number;
      sourceRef?: { sheet?: string; cell?: string } | undefined;
    },
  ): void => {
    if (e.value == null || e.confidence < 0.5) return;
    const src = e.sourceRef?.cell
      ? ` (${e.sourceRef.sheet ? `${e.sourceRef.sheet}!` : ''}${e.sourceRef.cell})`
      : '';
    lines.push(
      `- ${label}: ${JSON.stringify(e.value)}${src}, confidence ${e.confidence.toFixed(2)}`,
    );
  };

  lines.push('Header:');
  env('  policyNumber', p.header.policyNumber);
  env('  period', {
    value: p.header.period.value
      ? `${p.header.period.value.from} → ${p.header.period.value.to}`
      : null,
    confidence: p.header.period.confidence,
    sourceRef: p.header.period.sourceRef,
  });
  env('  currency', p.header.currency);
  env('  administrationType', p.header.administrationType);
  env('  lastEntryAge', p.header.lastEntryAge);
  if (p.header.ageLimitNoUnderwriting)
    env('  ageLimitNoUnderwriting', p.header.ageLimitNoUnderwriting);
  if (p.header.aboveLastEntryAge) env('  aboveLastEntryAge', p.header.aboveLastEntryAge);
  if (p.header.employeeAgeLimit) env('  employeeAgeLimit', p.header.employeeAgeLimit);
  if (p.header.spouseAgeLimit) env('  spouseAgeLimit', p.header.spouseAgeLimit);
  if (p.header.childAgeLimit) env('  childAgeLimit', p.header.childAgeLimit);
  if (p.header.childMinimumAge) env('  childMinimumAge', p.header.childMinimumAge);

  lines.push('');
  lines.push('Policyholder:');
  env('  legalName', p.policyholder.legalName);
  env('  uen', p.policyholder.uen);
  env('  address', p.policyholder.address);

  if (p.plans.length > 0) {
    lines.push('');
    lines.push(`Plans (${p.plans.length}):`);
    for (const pl of p.plans.slice(0, 20)) {
      lines.push(
        `  - rawCode="${pl.rawCode}" rawName="${pl.rawName}" confidence ${pl.confidence.toFixed(2)}`,
      );
    }
    if (p.plans.length > 20) lines.push(`  (${p.plans.length - 20} more)`);
  }

  if (p.premiumRates.length > 0) {
    lines.push('');
    lines.push(`Premium rates (${p.premiumRates.length} rows). Sample:`);
    for (const r of p.premiumRates.slice(0, 5)) {
      const rateOrFixed =
        r.ratePerThousand != null
          ? `ratePerThousand=${r.ratePerThousand}`
          : r.fixedAmount != null
            ? `fixedAmount=${r.fixedAmount}`
            : 'rate=_';
      lines.push(
        `  - planRawCode="${r.planRawCode}" coverTier="${r.coverTier ?? '_'}" ${rateOrFixed} confidence ${r.confidence.toFixed(2)}`,
      );
    }
    if (p.premiumRates.length > 5) lines.push(`  (${p.premiumRates.length - 5} more)`);
  }

  if (p.benefits.length > 0) {
    lines.push('');
    lines.push(`Benefits (${p.benefits.length}). Sample:`);
    for (const b of p.benefits.slice(0, 5)) {
      lines.push(`  - "${b.rawName}" confidence ${b.confidence.toFixed(2)}`);
    }
    if (p.benefits.length > 5) lines.push(`  (${p.benefits.length - 5} more)`);
  }

  return lines.join('\n');
}
