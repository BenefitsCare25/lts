// =============================================================
// Discovery-pass user prompt builder.
//
// Frames the workbook for the discovery call:
//   - Identify every distinct (productTypeCode, insurerCode) tuple
//   - Locate cross-cutting metadata (client, entities, period, etc.)
//   - DO NOT extract per-product field values yet
//
// The heuristic baseline (when present) is included as a starter so
// the model can confirm or override the parser's findings rather
// than re-discovering everything from scratch.
// =============================================================

import type { ExtractedProduct } from '@/server/extraction/heuristic-to-envelope';

export function buildDiscoveryUserPrompt(
  workbookText: string,
  heuristicProducts: ExtractedProduct[],
  retryHint: string | undefined,
): string {
  const retryBlock = retryHint
    ? [
        '',
        '## Retry — your previous discovery output failed schema validation',
        '',
        'Fix the following issues and re-emit the FULL discovery result:',
        '```',
        retryHint,
        '```',
        '',
      ]
    : [];

  const heuristicBlock =
    heuristicProducts.length > 0
      ? [
          '## Heuristic baseline (deterministic parser already ran)',
          '',
          'The Excel template parser already located these (productTypeCode, insurerCode) ' +
            'combinations at high confidence. Use them as a starting point; you may add to or ' +
            'override this list if the workbook clearly contains more (or different) products:',
          '',
          ...heuristicProducts.map(
            (p) =>
              `- productTypeCode=${p.productTypeCode} insurerCode=${p.insurerCode} ` +
              `(${p.plans.length} plan(s), ${p.premiumRates.length} rate row(s))`,
          ),
          '',
          '**Important — insurerCode canonicalisation.** The heuristic insurer codes above ' +
            "(e.g. 'GE', 'ZI', 'CI') are the tenant's registered codes for those insurers. " +
            'Re-use them verbatim in your `productManifest` and `proposedInsurers` entries — ' +
            "do NOT invent a different short or long form (e.g. 'GE_LIFE' vs 'GE'), even if " +
            'the catalogue insurer list shows a different code. The downstream merge step ' +
            'keys on `productTypeCode::insurerCode`; mismatched casing or alternate forms ' +
            "produce duplicate products in the wizard. If the catalogue's official code for " +
            'an insurer differs from the heuristic code, still emit the heuristic code here — ' +
            'the runtime canonicalises both sides separately.',
          '',
        ]
      : [];

  return [
    'You are running the DISCOVERY pass of a map-reduce extraction. Your job is to identify',
    'WHAT is in this workbook so the per-product passes can extract each product in detail.',
    '',
    'Specifically:',
    '1. Identify every distinct (productTypeCode, insurerCode) combination — these become',
    '   `productManifest` entries. Aggregator workbooks where one insurer covers GHS + GTL +',
    '   GPA produce three entries with the same insurerCode. STM-style workbooks where four',
    '   insurers each cover GHS produce four entries with the same productTypeCode.',
    "2. For each manifest entry, list the sheet names that contain that product's data.",
    '   The per-product pass will focus its attention there.',
    '3. Extract the cross-cutting metadata: proposedClient, proposedPolicyEntities,',
    '   proposedBenefitYear, proposedInsurers, proposedPool. These are slip-level (not',
    '   per-product) so we extract them once here.',
    '',
    'Do NOT extract per-product field values (plans, premium rates, benefits, eligibility',
    'matrix, etc.). Those come back from separate per-product passes.',
    '',
    'Cross-cutting field guidance:',
    '- proposedClient: the policyholder. Look in any sheet header — legal entity name, UEN,',
    '  registered address, business activity. If sheets disagree, prefer the value most sheets',
    '  share.',
    '- proposedPolicyEntities: every legal entity covered by the master policy. Mark exactly',
    '  one entity as `isMaster: true` (the entity whose policy number is the headline number',
    '  on the slip cover page). If the same `legalName` appears with different `policyNumber`',
    '  values across rows (e.g. "STMICROELECTRONICS PTE LTD" with both G0005088 (AMK) and',
    '  G0005089 (TPY) in a billing-numbers sheet), emit ONE row per (legalName, policyNumber)',
    '  pair — they are distinct policy entities even when the legal name is shared.',
    '  **Address vs siteCode (V-5):** For non-master entities, if the slip only gives a short',
    '  site/branch code (e.g. "AMK", "TPY", "HQ", "JTC") rather than a full postal address,',
    '  set `siteCode` to that code and leave `address` null. A full Singapore address has a',
    '  postal code and a street — put that in `address`. Do NOT put site codes in `address`.',
    '  **Headcount (V-6):** Scan the "Billing numbers" sheet (if present) for a column block',
    '  matching this entity\'s policy number or legal name. Sum all "* No. of employees" or',
    '  "No. of Lives" row values in that block to get a headcount estimate. Set `headcountEstimate`',
    '  to the integer sum. If the slip has no Billing numbers sheet, set `headcountEstimate` null.',
    '- proposedBenefitYear: `policyName` is typically "<Year> Renewal — Employee Benefits",',
    '  `startDate`/`endDate` come from the period of insurance row most products share.',
    '  `ageBasis` defaults to POLICY_START unless the slip mentions hire-date or event-based',
    '  age computation explicitly.',
    '- proposedInsurers: one entry per unique insurer the slip references, with productCount',
    '  matching the number of manifest entries for that insurer.',
    '  **Insurer code canonicalization (V-7):** Map each slip label to the canonical code from',
    '  the tenant insurer registry (provided in the system prompt). If no exact match, emit',
    '  the slip label uppercased and underscored (e.g. "Some Life Co" → "SOME_LIFE_CO").',
    '- proposedPool: only set when the slip mentions a captive / industry pool. Look for a',
    '  `Pool : <name>` row (singular or plural) on every product sheet — STM-style aggregator',
    '  slips repeat the same pool on each product sheet (e.g. "Generali Pool - Captive",',
    '  "NTUC GBT", "PAP-CARE Pool"). Treat values like "NA", "N.A", "N/A" as no pool. Match',
    '  against the catalogue list when possible. Null otherwise.',
    '- warnings: caveats the broker should know — contradictions between sheets, ambiguous',
    '  plan stacking, missing rate cells, illegible cell text, etc.',
    '',
    ...heuristicBlock,
    ...retryBlock,
    '## Workbook',
    '',
    'Each populated cell is shown as `A1: value`. Empty cells omitted. Cells over 800 chars',
    'truncated with an ellipsis. Sheets separated by `---`.',
    '',
    workbookText,
    '',
    '## Now emit the discovery',
    '',
    'Call the `emit_discovery` tool exactly once.',
  ].join('\n');
}
